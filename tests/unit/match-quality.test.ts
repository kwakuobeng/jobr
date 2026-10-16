import { describe, expect, it, vi } from "vitest";
import { classifyLocation, classifyLocations, jobRegion, usOrRemote } from "../../src/lib/jobs/region";
import { isGenericChip, mergeQueryWithChips, monotonicScores } from "../../src/lib/jobs/model";
import { bindingEmbedder, jobEmbeddingText, profileEmbeddingText, restEmbedder, sha256Hex, toVectorLiteral } from "../../src/lib/embeddings";
import { ensureProfileEmbedding } from "../../src/lib/jobs/profile-embedding";

describe("region classifier (live-data misses from the investigation)", () => {
  it.each([
    ["San Francisco", "US"], ["San Francisco Office", "US"], ["Seattle Office", "US"], ["Austin, us", "US"],
    ["San Francisco, CA, us", "US"], ["Remote NY", "US"], ["Remote - CA", "US"], ["Dallas, TX", "US"], ["New York", "US"],
    ["Beijing, cn", "CN"], ["Adelaide, SA, au", "AU"], ["London, gb", "GB"], ["Remote - UK", "XX"], ["Berlin Office", "XX"],
    ["Toronto, ON, ca", "CA"], ["Remote", null], ["", null], ["All locations", null],
  ])("%s → %s", (text, code) => expect(classifyLocation(text)).toBe(code));
  it("any US location makes a multi-office role US; stored region wins", () => {
    expect(classifyLocations(["London, gb", "Seattle Office"])).toEqual({ region: "us", country_codes: ["GB", "US"] });
    expect(classifyLocations(["Remote"])).toEqual({ region: "unknown", country_codes: [] });
    expect(jobRegion({ locations_json: ["Somewhere"], region: "us" })).toBe("us");
    expect(jobRegion({ locations_json: ["Berlin Office"], region: "unknown" })).toBe("non_us");
    expect(usOrRemote({ workplace_type: "hybrid", locations_json: ["San Francisco Office"] })).toBe(true);
  });
});

describe("lexical query and displayed score", () => {
  it("drops generic one-word chips but keeps specific tools and phrases", () => {
    expect(isGenericChip("Closing")).toBe(true);
    expect(isGenericChip("Salesforce")).toBe(false);
    expect(isGenericChip("enterprise sales")).toBe(false);
    const q = mergeQueryWithChips("", { titles: [], skills: ["Salesforce", "closing", "CRM", "Outbound", "MEDDIC", "enterprise account executive"] });
    expect(q).toBe('"Salesforce" or "MEDDIC" or "enterprise account executive"');
  });
  it("monotonicScores never lets a lower row show a higher score", () => {
    expect(monotonicScores([{ match_score: 8 }, { match_score: 9 }, { match_score: 6 }, { match_score: 7 }]).map((r) => r.match_score)).toEqual([8, 8, 6, 6]);
  });
});

describe("embeddings (Workers AI bge-base, 768-dim)", () => {
  const vec = Array(768).fill(0.5);
  it("binding embedder batches by 50 and validates shape", async () => {
    const run = vi.fn(async (_m: string, input: { text: string[] }) => ({ data: input.text.map(() => vec) }));
    expect(await bindingEmbedder({ run })(Array(60).fill("x"))).toHaveLength(60);
    expect(run).toHaveBeenCalledTimes(2);
    await expect(bindingEmbedder({ run: async () => ({ data: [[1, 2]] }) })(["x"])).rejects.toThrow("768");
    await expect(bindingEmbedder({ run: async () => ({}) })(["x"])).rejects.toThrow("shape");
  });
  it("REST embedder posts to the account endpoint and surfaces HTTP errors", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ result: { data: [vec] } })));
    const id = "a".repeat(32);
    expect(await restEmbedder(id, "t", ok as unknown as typeof fetch)(["x"])).toHaveLength(1);
    expect(String((ok.mock.calls[0] as unknown[])[0])).toContain(`/accounts/${id}/ai/run/@cf/baai/bge-base-en-v1.5`);
    await expect(restEmbedder(id, "t", (async () => new Response("", { status: 429 })) as unknown as typeof fetch)(["x"])).rejects.toThrow("429");
    expect(() => restEmbedder("bad", "t")).toThrow("account id");
  });
  it("builds compact job/profile texts", async () => {
    expect(jobEmbeddingText({ title: "AE", employer_name: "Acme", extracted_required_skills: ["Salesforce"], description_plain: "<p>Sell &amp; close</p>" })).toBe("AE. AE at Acme. Skills: Salesforce. Sell close");
    expect(jobEmbeddingText({ title: "AE", employer_name: "Acme" })).toBe("AE. AE at Acme.");
    expect(profileEmbeddingText(null)).toBeNull();
    expect(profileEmbeddingText({ titles: [], skills: [] })).toBeNull();
    expect(profileEmbeddingText({ titles: ["AE"], skills: ["Salesforce"] })).toBe("Target roles: AE. Skills: Salesforce.");
    expect(profileEmbeddingText({ titles: [], skills: ["Salesforce"] })).toBe("Skills: Salesforce.");
    expect(await sha256Hex("a")).toBe("ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
    expect(toVectorLiteral([1, 2])).toBe("[1,2]");
  });
  it("profile embedding is refreshed only when the chip text changes", async () => {
    const chips = { titles: ["AE"], skills: ["Salesforce"] };
    const ai = { run: vi.fn(async () => ({ data: [vec] })) };
    const make = (hash: string | null, updateError: unknown = null) => {
      const updates: unknown[] = [];
      const b: Record<string, unknown> = {};
      b.select = () => b; b.eq = () => b; b.maybeSingle = async () => ({ data: { target_embedding_source_hash: hash }, error: null });
      b.update = (v: unknown) => { updates.push(v); return { eq: () => ({ eq: async () => ({ error: updateError }) }) }; };
      return { client: { from: () => b }, updates };
    };
    const fresh = make(null);
    expect(await ensureProfileEmbedding(fresh.client, "u", "p", chips, ai)).toBe("updated");
    expect(fresh.updates[0]).toMatchObject({ target_embedding_model: "@cf/baai/bge-base-en-v1.5" });
    const hash = (fresh.updates[0] as { target_embedding_source_hash: string }).target_embedding_source_hash;
    expect(await ensureProfileEmbedding(make(hash).client, "u", "p", chips, ai)).toBe("current");
    expect(await ensureProfileEmbedding(make(null, { message: "x" }).client, "u", "p", chips, ai)).toBe("skipped");
    expect(await ensureProfileEmbedding(make(null).client, "u", "p", chips, null)).toBe("skipped");
    expect(await ensureProfileEmbedding(make(null).client, "u", "p", chips, { run: async () => { throw new Error("quota"); } })).toBe("skipped");
  });
});
