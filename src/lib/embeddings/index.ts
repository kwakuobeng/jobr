/**
 * Embeddings via Cloudflare Workers AI (free daily allocation; D8). Model and dimension must match
 * the vector(768) columns from migration 0009. Works with the Worker binding (`env.AI`) or, for
 * scripts, the Workers AI REST API.
 */
export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBEDDING_DIMENSIONS = 768;
const MAX_CHARS = 2000; // bge-base truncates at 512 tokens; keep the most informative text.
const BATCH = 50;

export interface AiBinding {
  run(model: string, input: { text: string[] }): Promise<unknown>;
}
export type Embedder = (texts: string[]) => Promise<number[][]>;

function parseVectors(output: unknown, expected: number): number[][] {
  const data = (output as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length !== expected) throw new Error("Embedding response has the wrong shape");
  return data.map((row) => {
    if (!Array.isArray(row) || row.length !== EMBEDDING_DIMENSIONS || !row.every((v) => typeof v === "number" && Number.isFinite(v)))
      throw new Error(`Embedding must have ${EMBEDDING_DIMENSIONS} finite numbers`);
    return row as number[];
  });
}
async function inBatches(texts: string[], run: (batch: string[]) => Promise<unknown>): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    out.push(...parseVectors(await run(batch), batch.length));
  }
  return out;
}
export function bindingEmbedder(ai: AiBinding): Embedder {
  return (texts) => inBatches(texts, (text) => ai.run(EMBEDDING_MODEL, { text }));
}
/** REST fallback for scripts: needs CLOUDFLARE_ACCOUNT_ID and an API token with Workers AI read. */
export function restEmbedder(accountId: string, apiToken: string, fetchImpl: typeof fetch = fetch): Embedder {
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw new Error("Invalid Cloudflare account id");
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`;
  return (texts) => inBatches(texts, async (text) => {
    const response = await fetchImpl(url, { method: "POST", headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!response.ok) throw new Error(`Workers AI returned HTTP ${response.status}`);
    return ((await response.json()) as { result?: unknown }).result;
  });
}
const clean = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
/** Job text: title (twice, so the role dominates), employer, skills, then the description head. */
export function jobEmbeddingText(job: { title: string; employer_name: string; extracted_required_skills?: string[] | null; description_plain?: string | null }): string {
  const skills = (job.extracted_required_skills ?? []).join(", ");
  return clean(`${job.title}. ${job.title} at ${job.employer_name}. ${skills ? `Skills: ${skills}. ` : ""}${job.description_plain ?? ""}`).slice(0, MAX_CHARS);
}
/** Profile text from confirmed resume chips (titles + skills); null when there is nothing to embed. */
export function profileEmbeddingText(chips: { titles: string[]; skills: string[] } | null): string | null {
  if (!chips || (!chips.titles.length && !chips.skills.length)) return null;
  const titles = chips.titles.slice(0, 8).join(", ");
  return clean(`${titles ? `Target roles: ${titles}. ` : ""}Skills: ${chips.skills.slice(0, 40).join(", ")}.`).slice(0, MAX_CHARS);
}
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** pgvector text literal for PostgREST writes. */
export const toVectorLiteral = (vector: number[]) => `[${vector.join(",")}]`;
