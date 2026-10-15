import { describe, expect, it, vi } from "vitest";
import { SYNTHETIC_SALES_RESUME as raw } from "../fixtures/synthetic-sales-resume";
import { suggestChips } from "@/lib/resume-intake/heuristic";
import { inferSkills, mergeSuggestions, MAX_SUGGESTIONS, ROLE_FAMILIES } from "@/lib/resume-intake/inferred";
import { aiInferSkills } from "@/lib/resume-intake/ai";
import { isOutdated, parseResumeText, unionChips } from "@/lib/resume-intake/service";
import { CURRENT_PARSER, SuggestedSkill } from "@/lib/resume-intake/model";

const REF = "2026-10-15";
const provider = { name: "xai" as const, url: "https://api.x.ai/v1/chat/completions", key: "k", model: "m" };
describe("inferred (Suggested) skills", () => {
  const local = suggestChips(raw, REF);
  const suggested = inferSkills(raw, local.chips.titles, local.chips.skills);
  it("infers role-family skills with a one-line reason citing the title", () => {
    const negotiation = suggested.find((s) => s.name === "Objection handling");
    expect(negotiation?.reason).toMatch(/^Common for (?:account executive|SDR\/BDR) roles; inferred from your title "/);
    expect(suggested.every((s) => s.source === "rules" && SuggestedSkill.safeParse(s).success)).toBe(true);
    expect(suggested.every((s) => !s.reason.includes("\n") && s.reason.length <= 240)).toBe(true);
  });
  it("never duplicates an explicit skill and is capped", () => {
    const explicit = new Set(local.chips.skills.map((s) => s.toLowerCase()));
    expect(suggested.some((s) => explicit.has(s.name.toLowerCase()))).toBe(false);
    expect(suggested.length).toBeGreaterThan(3); expect(suggested.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    expect(new Set(suggested.map((s) => s.name.toLowerCase())).size).toBe(suggested.length);
  });
  it("covers sales, SDR, analyst/BI and RevOps families", () => {
    const pick = (title: string) => inferSkills("", [title], []).map((s) => s.name);
    expect(pick("Enterprise Account Executive")).toContain("Negotiation");
    expect(pick("Business Development Representative")).toContain("Cold calling");
    expect(pick("BI Analyst")).toEqual(expect.arrayContaining(["SQL", "Dashboarding"]));
    expect(pick("Revenue Operations Manager")).toContain("CRM administration");
    expect(pick("Chef")).toEqual([]);
    expect(ROLE_FAMILIES.length).toBeGreaterThanOrEqual(8);
  });
  it("infers from achievements and quotes the source line", () => {
    const out = inferSkills("• Closed $763K against a $900K annual quota\n• Built ROI models for finance chiefs", [], []);
    expect(out.find((s) => s.name === "Closing")?.reason).toContain('"Closed $763K against a $900K annual quota"');
    expect(out.map((s) => s.name)).toEqual(expect.arrayContaining(["Executive selling", "Business case development"]));
  });
  it("merges model suggestions after rules without duplicates", () => {
    const merged = mergeSuggestions([{ name: "Closing", reason: "r", source: "rules" }], [{ name: "closing", reason: "dup", source: "ai" }, { name: "Territory design", reason: "AI", source: "ai" }, { name: "SQL", reason: "explicit", source: "ai" }], ["SQL"]);
    expect(merged.map((s) => s.name)).toEqual(["Closing", "Territory design"]);
  });
});
describe("review parse", () => {
  it("keeps explicit skills in chips and inferred ones only in suggested_skills", async () => {
    const result = await parseResumeText(raw, REF, { provider: null });
    expect(result.parser).toBe(CURRENT_PARSER); expect(result.suggested_skills.length).toBeGreaterThan(0);
    const chips = new Set(result.chips.skills.map((s) => s.toLowerCase()));
    expect(result.suggested_skills.some((s) => chips.has(s.name.toLowerCase()))).toBe(false);
    expect(result.extraction.extracted_skills.every((s) => raw.includes(s.evidence.verbatim_quote))).toBe(true);
  });
  it("adds model suggestions (wrapped untrusted input) and drops unsafe ones", async () => {
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }>; response_format: { json_schema: { name: string } } };
      if (body.response_format.json_schema.name !== "inferred_skills") return new Response("no", { status: 500 });
      expect(body.messages[1]!.content).toMatch(/^<untrusted_job_data_[0-9a-f]{32}>/);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ suggestions: [
        { name: "Territory design", reason: "Owned a 10+ account territory as an AE." },
        { name: "Bad", reason: "see https://evil.example" }, { name: "x".repeat(90), reason: "too long" },
      ] }) } }] }), { status: 200 });
    });
    const result = await parseResumeText(raw, REF, { provider, fetchImpl: fetchImpl as unknown as typeof fetch });
    const ai = result.suggested_skills.filter((s) => s.source === "ai");
    expect(ai.map((s) => s.name)).toEqual(["Territory design"]);
    expect(result.ai).toBeNull(); expect(result.ai_error).toBe("Error"); // extraction failed, parse still succeeded
  });
  it("model inference errors and timeouts fall back to rules only", async () => {
    const fetchImpl = vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); });
    expect(await aiInferSkills(raw, [], { provider, fetchImpl: fetchImpl as unknown as typeof fetch }).catch(() => "threw")).toBe("threw");
    const result = await parseResumeText(raw, REF, { provider, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.suggested_skills.length).toBeGreaterThan(0); expect(result.suggested_skills.every((s) => s.source === "rules")).toBe(true);
    expect(await aiInferSkills(raw, [], { provider: null })).toBeNull();
  });
});
describe("re-parse helpers", () => {
  it("marks old parser versions as outdated", () => {
    expect(isOutdated("local-v1")).toBe(true); expect(isOutdated("local-v2+ai")).toBe(true); expect(isOutdated(undefined)).toBe(true);
    expect(isOutdated(CURRENT_PARSER)).toBe(false); expect(isOutdated(`${CURRENT_PARSER}+ai`)).toBe(false);
  });
  it("keeps user-added chips on re-parse, new results first, case-insensitive", () => {
    expect(unionChips({ skills: ["Salesforce", "MEDDPICC"], titles: ["Enterprise Account Executive"], years: 7 }, { skills: ["salesforce", "Outbound"], titles: [], years: null }))
      .toEqual({ skills: ["Salesforce", "MEDDPICC", "Outbound"], titles: ["Enterprise Account Executive"], years: 7 });
  });
});
