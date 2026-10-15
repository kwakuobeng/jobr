import { RESUME_EXTRACTION_FORMAT, ResumeExtractionSchema, SYSTEM_PROMPTS, wrapUntrustedJobData } from "../../../specs/ai/structured_schemas";
import { mapResumeLines, verifyEvidence } from "@/lib/resume/quote-verifier";
import { validateResumeExtraction } from "@/lib/resume/structured-parser";

/** Server-only provider config. Keys are read from process.env at request time and never exposed to the client. */
export interface AiProvider { name: "xai" | "openai"; url: string; key: string; model: string }
export function resolveProvider(env: Record<string, string | undefined> = process.env): AiProvider | null {
  if (env.XAI_API_KEY) return { name: "xai", url: "https://api.x.ai/v1/chat/completions", key: env.XAI_API_KEY, model: env.XAI_MODEL || "grok-4-fast-non-reasoning" };
  if (env.OPENAI_API_KEY) return { name: "openai", url: "https://api.openai.com/v1/chat/completions", key: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || "gpt-4o-mini" };
  return null;
}

/** Keep only items whose evidence verifies against the raw text, then run the strict validator. */
export function groundAiExtraction(value: unknown, raw: string, referenceDate: string) {
  const parsed = ResumeExtractionSchema.parse(value);
  const ok = (e: { source_line_ids: string[]; verbatim_quote: string }) => verifyEvidence(raw, e);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const filtered = {
    work_experiences: parsed.work_experiences.filter((w) => ok(w.evidence) && iso.test(w.start_date) && (w.end_date === null || iso.test(w.end_date)) && w.start_date <= referenceDate && (w.end_date ?? referenceDate) <= referenceDate && w.start_date <= (w.end_date ?? referenceDate)),
    education: parsed.education.filter((e) => ok(e.evidence)),
    certifications: parsed.certifications.filter((c) => ok(c.evidence)),
    extracted_skills: parsed.extracted_skills.filter((s) => ok(s.evidence) && s.name.trim().length > 0 && s.name.length <= 80),
    accomplishments: parsed.accomplishments.filter((a) => a.evidence.length > 0 && a.evidence.every(ok)),
  };
  return validateResumeExtraction(filtered, raw, referenceDate);
}

export async function aiExtract(raw: string, referenceDate: string, options: { provider?: AiProvider | null; fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
  const provider = options.provider === undefined ? resolveProvider() : options.provider;
  if (!provider) return null;
  const numbered = mapResumeLines(raw).map((l) => `${l.id}: ${l.text}`).join("\n");
  const input = wrapUntrustedJobData(numbered.slice(0, 150_000)).xml;
  const response = await (options.fetchImpl ?? fetch)(provider.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(options.timeoutMs ?? 25_000),
    body: JSON.stringify({
      model: provider.model,
      temperature: 0,
      messages: [
        { role: "system", content: `${SYSTEM_PROMPTS.resume} Each line is prefixed with its line ID followed by ": "; the ID prefix is not part of the quote. Quotes must be exact substrings of a single line's text. Dates must be ISO YYYY-MM-DD (use the first of the month).` },
        { role: "user", content: input },
      ],
      response_format: { type: "json_schema", json_schema: { name: RESUME_EXTRACTION_FORMAT.name, strict: true, schema: RESUME_EXTRACTION_FORMAT.schema } },
    }),
  });
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI provider returned no content");
  return { provider: provider.name, model: provider.model, extraction: groundAiExtraction(JSON.parse(content), raw, referenceDate) };
}
