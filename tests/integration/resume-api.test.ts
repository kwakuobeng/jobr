import { beforeEach, expect, it, vi } from "vitest";
import { PDF } from "@/lib/resume-intake/model";
const state = vi.hoisted(() => {
  type Result = { data: unknown; error: null | { code: string; message: string } };
  const results: Result[] = [];
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), single: vi.fn(), maybeSingle: vi.fn(), insert: vi.fn(), update: vi.fn(),
    then: (resolve: (value: Result) => unknown) => Promise.resolve(results.shift() ?? { data: null, error: null }).then(resolve) };
  const bucket = { upload: vi.fn(), remove: vi.fn() };
  const client = { from: vi.fn(() => query), auth: { getUser: vi.fn() }, storage: { from: vi.fn(() => bucket) } };
  return { results, query, client, bucket, preferences: vi.fn(), extract: vi.fn() };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
vi.mock("@/lib/jobs/service", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/jobs/service")>(), ensurePreferences: state.preferences }));
vi.mock("@/lib/resume-intake/extract", () => ({ extractResumeText: state.extract }));
vi.stubEnv("XAI_API_KEY", ""); vi.stubEnv("OPENAI_API_KEY", "");
import { GET, PATCH, POST } from "@/app/api/resume/route";
import { readBoundedBody } from "@/lib/resume-intake/service";
import { JobError } from "@/lib/jobs/service";
const userId = "aaaaaaaa-0000-4000-8000-000000000001";
const profileId = "bbbbbbbb-0000-4000-8000-000000000002";
const resumeId = "cccccccc-0000-4000-8000-000000000003";
const versionId = "dddddddd-0000-4000-8000-000000000004";
const row = { id: resumeId, original_filename: "resume.pdf", parse_status: "completed" };
const chips = { skills: ["TypeScript"], titles: ["Software Engineer"], years: 5 };
const version = { id: versionId, is_user_approved: false, normalized_profile_json: { chips, parser: "local-v1", extraction: { retained: true } } };
const ok = (data: unknown = null) => ({ data, error: null });
function upload(type = PDF) {
  const form = new FormData(); form.set("file", new File(["%PDF-1.4 fake PDF for the mocked parser"], "resume.pdf", { type }));
  return new Request("https://jobr.example/api/resume", { method: "POST", headers: { Origin: "https://jobr.example" }, body: form });
}
function patch(body: unknown) { return new Request("https://jobr.example/api/resume", { method: "PATCH", headers: { Origin: "https://jobr.example", "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.clearAllMocks(); state.results.length = 0;
  Object.values(state.query).forEach((fn) => { if (vi.isMockFunction(fn)) fn.mockReturnValue(state.query); });
  state.client.auth.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  state.preferences.mockResolvedValue({ candidate_profile_id: profileId });
  state.bucket.upload.mockResolvedValue({ error: null }); state.bucket.remove.mockResolvedValue({ error: null });
  state.extract.mockResolvedValue("Software Engineer\nTypeScript\n5 years of experience");
});
it("rejects anonymous reads and uploads before Storage access", async () => {
  state.client.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await GET()).status).toBe(401); expect((await POST(upload())).status).toBe(401);
  expect(state.client.storage.from).not.toHaveBeenCalled();
});
it("returns an empty current resume without fabricating data", async () => {
  state.results.push(ok()); const response = await GET(); expect(response.status).toBe(200); expect(await response.json()).toBeNull();
});
it("returns the persisted latest chips and approval under the signed-in owner", async () => {
  state.results.push(ok(row), ok(version)); const response = await GET();
  expect(await response.json()).toMatchObject({ id: resumeId, chips, use_for_matching: false, version_id: versionId });
  expect(state.query.eq).toHaveBeenCalledWith("user_id", userId);
});
it("rejects bad upload MIME without creating rows or files", async () => {
  expect((await POST(upload("text/html"))).status).toBe(400); expect(state.client.from).not.toHaveBeenCalled(); expect(state.bucket.upload).not.toHaveBeenCalled();
});
it("uploads privately with a digest and persists grounded text, line map, chips and completed status", async () => {
  state.results.push(ok(), ok(), ok()); const response = await POST(upload()); const result = await response.json();
  expect(response.status).toBe(200); expect(result).toMatchObject({ parse_status: "completed", use_for_matching: false, chips: { skills: ["TypeScript"], years: 5 } });
  expect(state.client.storage.from).toHaveBeenCalledWith("resumes");
  expect(state.bucket.upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${userId}/[a-f0-9-]+/source.pdf$`)), expect.any(Uint8Array), { contentType: PDF, upsert: false });
  expect(state.query.insert).toHaveBeenCalledWith(expect.objectContaining({ file_sha256: expect.stringMatching(/^[a-f0-9]{64}$/), user_id: userId, parse_status: "processing" }));
  expect(state.query.update).toHaveBeenCalledWith(expect.objectContaining({ parse_status: "completed", structured_line_map: expect.any(Array), raw_extracted_text: expect.stringContaining("TypeScript") }));
});
it("marks extraction failures as failed rather than fabricating chips", async () => {
  state.extract.mockRejectedValue(new Error("corrupt PDF")); state.results.push(ok(), ok());
  expect(await (await POST(upload())).json()).toMatchObject({ parse_status: "failed", chips: null });
  expect(state.query.update).toHaveBeenCalledWith({ parse_status: "failed" });
});
it("fails closed with an actionable error if private bucket is unavailable", async () => {
  state.bucket.upload.mockResolvedValue({ error: { statusCode: "404", message: "bucket missing" } });
  const response = await POST(upload()); expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ message: expect.stringContaining("0007") });
  expect(state.query.insert).not.toHaveBeenCalled();
});
it("removes the uploaded object when the RLS row insert fails", async () => {
  state.results.push({ data: null, error: { code: "42501", message: "RLS" } });
  expect((await POST(upload())).status).toBe(403); expect(state.bucket.remove).toHaveBeenCalled();
});
it("rejects ownership failures and cross-origin writes", async () => {
  state.preferences.mockRejectedValueOnce(new JobError("FORBIDDEN", "Unowned profile", 403));
  expect((await GET()).status).toBe(403);
  expect((await PATCH(new Request("https://jobr.example/api/resume", { method: "PATCH", headers: { Origin: "https://evil.example" }, body: "{}" }))).status).toBe(403);
});
it("edits only an owned completed version and preserves extraction provenance", async () => {
  state.results.push(ok(row), ok(version), ok({ id: versionId }));
  const edited = { ...chips, skills: ["TypeScript", "SQL"] };
  const response = await PATCH(patch({ resume_id: resumeId, version_id: versionId, chips: edited, use_for_matching: true }));
  expect(await response.json()).toMatchObject({ chips: edited, use_for_matching: true });
  expect(state.query.update).toHaveBeenCalledWith({ normalized_profile_json: { ...version.normalized_profile_json, chips: edited, chips_user_edited: true }, is_user_approved: true });
  expect(state.query.eq).toHaveBeenCalledWith("base_resume_id", resumeId);
});
it("cannot attach edits to another user's resume/version", async () => {
  state.results.push(ok(null));
  expect((await PATCH(patch({ resume_id: resumeId, version_id: versionId, chips, use_for_matching: true }))).status).toBe(403);
  expect(state.query.update).not.toHaveBeenCalled();
});
it("bounds chunked requests even without Content-Length", async () => {
  await expect(readBoundedBody(new Request("https://jobr.example", { method: "POST", body: "long body" }), 3)).rejects.toMatchObject({ status: 413 });
});
