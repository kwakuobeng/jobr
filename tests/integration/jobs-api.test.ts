import { beforeEach, expect, it, vi } from "vitest";
import { ApiErrorSchema } from "../../specs/api/contracts";
const state = vi.hoisted(() => {
  type Result = { data: unknown; error: null | { code: string; message: string } };
  const results: Result[] = [];
  const query = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(), single: vi.fn(), upsert: vi.fn(), update: vi.fn(),
    then: (onfulfilled: (value: Result) => unknown) => Promise.resolve(results.shift() ?? { data: null, error: null }).then(onfulfilled),
  };
  const client = { from: vi.fn(() => query), rpc: vi.fn(), auth: { getUser: vi.fn() } };
  return { results, query, client };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
import { GET, PUT } from "@/app/api/preferences/route";
import { POST } from "@/app/api/matches/route";
const profileId = "11111111-1111-4111-8111-111111111111";
const preferences = { candidate_profile_id: profileId, excluded_employer_ids: [], excluded_tech_slugs: [], allowed_workplace_types: ["remote"], allowed_employment_types: ["full_time"], hard_min_annual_salary_usd: null, allow_undisclosed_salary: true, requires_visa_sponsorship: false, max_commute_miles: null };
const result = (data: unknown) => ({ data, error: null });
const request = (path: string, body: unknown) => new Request(`https://jobr.example/api/${path}`, { method: path === "matches" ? "POST" : "PUT", headers: { Origin: "https://jobr.example", "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); state.results.length = 0;
  Object.values(state.query).forEach((fn) => { if (vi.isMockFunction(fn)) fn.mockReturnValue(state.query); });
  state.client.auth.getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
});
it("rejects unauthenticated matches before database access", async () => {
  state.client.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  const response = await POST(request("matches", {}));
  expect(response.status).toBe(401); expect(ApiErrorSchema.parse(await response.json()).code).toBe("UNAUTHENTICATED");
  expect(state.client.from).not.toHaveBeenCalled();
});
it("creates missing default rows with conflict-safe inserts and database defaults", async () => {
  state.results.push(result(null), result(null), result({ id: profileId }), result(null), result(preferences));
  const response = await GET();
  expect(response.status).toBe(200); expect(await response.json()).toEqual(preferences);
  expect(state.query.upsert).toHaveBeenNthCalledWith(1, { user_id: "owner", profile_name: "default", is_default: true }, { onConflict: "user_id,profile_name", ignoreDuplicates: true });
  expect(state.query.upsert).toHaveBeenNthCalledWith(2, { user_id: "owner", candidate_profile_id: profileId }, { onConflict: "candidate_profile_id", ignoreDuplicates: true });
  expect(state.results).toHaveLength(0);
});
it("persists validated preferences scoped to the signed-in owner", async () => {
  state.results.push(result({ id: profileId }), result(null), result(preferences), result(preferences));
  const response = await PUT(request("preferences", preferences));
  expect(response.status).toBe(200); expect(await response.json()).toEqual(preferences);
  expect(state.query.update).toHaveBeenCalledWith(preferences); expect(state.query.eq).toHaveBeenCalledWith("user_id", "owner");
});
it("rejects unowned profiles without writing", async () => {
  state.results.push(result(null));
  const response = await PUT(request("preferences", preferences));
  expect(response.status).toBe(403); expect(state.query.update).not.toHaveBeenCalled(); expect(state.query.upsert).not.toHaveBeenCalled();
});
it("forwards the real RPC parameters and returns an empty result", async () => {
  state.results.push(result({ id: profileId }), result(null), result(preferences));
  state.client.rpc.mockResolvedValue(result([]));
  const response = await POST(request("matches", { candidate_profile_id: profileId, query: "engineer", include_stretch_exceptions: false, limit: 12 }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual([]);
  expect(state.client.rpc).toHaveBeenCalledWith("match_jobs_hybrid", { p_candidate_profile_id: profileId, p_query_text: "engineer", p_include_stretch_exceptions: false, p_rrf_k: 60, p_top_n: 12 });
});
it("surfaces RLS permission errors as forbidden", async () => {
  state.results.push({ data: null, error: { code: "42501", message: "permission denied" } });
  expect((await GET()).status).toBe(403);
});
it("rejects invalid inputs and cross-origin writes", async () => {
  expect((await PUT(request("preferences", { ...preferences, max_commute_miles: 501 }))).status).toBe(400);
  const response = await PUT(new Request("https://jobr.example/api/preferences", { method: "PUT", headers: { Origin: "https://evil.example" }, body: "{}" }));
  expect(response.status).toBe(403);
});
