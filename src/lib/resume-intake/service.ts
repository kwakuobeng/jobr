import { z } from "zod";
import type { createClient } from "@/lib/supabase/server";
import { dbError, ensurePreferences, JobError } from "@/lib/jobs/service";
import { mapResumeLines } from "@/lib/resume/quote-verifier";
import { extractResumeText } from "./extract";
import { suggestChips } from "./heuristic";
import { Chips, MAX_FILE_BYTES, ResumePatch, ResumeView, storagePath, validateFile } from "./model";
type Client = Awaited<ReturnType<typeof createClient>>;
const Row = z.object({ id: z.string().uuid(), original_filename: z.string(), parse_status: ResumeView.shape.parse_status });
const Version = z.object({ id: z.string().uuid(), is_user_approved: z.boolean(), normalized_profile_json: z.object({ chips: Chips }).passthrough() });
const columns = "id,original_filename,parse_status";
function storageError(error: { message: string; statusCode?: string | number } | null) {
  if (!error) return;
  if (String(error.statusCode) === "403") throw new JobError("FORBIDDEN", "You do not have access to this resume file.", 403);
  throw new JobError("SOURCE_UNAVAILABLE", "Private resume storage is unavailable. Ensure migration 0007 has been applied and retry.", 503);
}
async function view(client: Client, userId: string, row: z.infer<typeof Row>) {
  if (row.parse_status !== "completed") return ResumeView.parse({ ...row, version_id: null, chips: null, use_for_matching: false });
  const result = await client.from("resume_versions").select("id,is_user_approved,normalized_profile_json").eq("user_id", userId).eq("base_resume_id", row.id).order("created_at", { ascending: false }).order("id").limit(1).single();
  dbError(result.error);
  const version = Version.parse(result.data);
  return ResumeView.parse({ ...row, version_id: version.id, chips: version.normalized_profile_json.chips, use_for_matching: version.is_user_approved });
}
export async function currentResume(client: Client, userId: string) {
  const preferences = await ensurePreferences(client, userId);
  const result = await client.from("resumes").select(columns).eq("user_id", userId).eq("candidate_profile_id", preferences.candidate_profile_id).order("created_at", { ascending: false }).order("id").limit(1).maybeSingle();
  dbError(result.error);
  return result.data ? view(client, userId, Row.parse(result.data)) : null;
}
export async function uploadResume(client: Client, userId: string, file: File) {
  try { validateFile(file); } catch (error) { throw new JobError("INVALID_INPUT", error instanceof Error ? error.message : "Invalid resume file.", 400); }
  const preferences = await ensurePreferences(client, userId);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((value) => value.toString(16).padStart(2, "0")).join("");
  const id = crypto.randomUUID(); const path = storagePath(userId, id, file.type);
  const bucket = client.storage.from("resumes");
  const upload = await bucket.upload(path, bytes, { contentType: file.type, upsert: false });
  storageError(upload.error);
  const inserted = await client.from("resumes").insert({ id, user_id: userId, candidate_profile_id: preferences.candidate_profile_id, original_filename: file.name, mime_type: file.type, storage_bucket_path: path, file_sha256: hash, file_size_bytes: file.size, raw_extracted_text: "", parse_status: "processing" });
  if (inserted.error) { await bucket.remove([path]); dbError(inserted.error); }
  let raw: string; let normalized: ReturnType<typeof suggestChips>;
  try {
    raw = await extractResumeText(bytes, file.type);
    normalized = suggestChips(raw);
  } catch {
    const failed = await client.from("resumes").update({ parse_status: "failed" }).eq("id", id).eq("user_id", userId);
    dbError(failed.error);
    return ResumeView.parse({ id, original_filename: file.name, parse_status: "failed", version_id: null, chips: null, use_for_matching: false });
  }
  const versionId = crypto.randomUUID();
  const version = await client.from("resume_versions").insert({ id: versionId, user_id: userId, base_resume_id: id, version_label: "Local extraction", normalized_profile_json: normalized, is_user_approved: false });
  if (version.error) {
    await client.from("resumes").update({ parse_status: "failed" }).eq("id", id).eq("user_id", userId);
    dbError(version.error);
  }
  const completed = await client.from("resumes").update({ raw_extracted_text: raw, structured_line_map: mapResumeLines(raw), parse_status: "completed" }).eq("id", id).eq("user_id", userId);
  dbError(completed.error);
  return ResumeView.parse({ id, original_filename: file.name, parse_status: "completed", version_id: versionId, chips: normalized.chips, use_for_matching: false });
}
export async function editResume(client: Client, userId: string, input: unknown) {
  const patch = ResumePatch.parse(input);
  const preferences = await ensurePreferences(client, userId);
  const row = await client.from("resumes").select(columns).eq("id", patch.resume_id).eq("user_id", userId).eq("candidate_profile_id", preferences.candidate_profile_id).maybeSingle();
  dbError(row.error);
  if (!row.data) throw new JobError("FORBIDDEN", "Resume not found or not owned by you.", 403);
  const resume = Row.parse(row.data);
  if (resume.parse_status !== "completed") throw new JobError("CONFLICT", "Wait for parsing to finish before editing.", 409);
  const result = await client.from("resume_versions").select("id,is_user_approved,normalized_profile_json").eq("id", patch.version_id).eq("base_resume_id", resume.id).eq("user_id", userId).maybeSingle();
  dbError(result.error);
  if (!result.data) throw new JobError("FORBIDDEN", "Resume version not found or not owned by you.", 403);
  const version = Version.parse(result.data);
  // User edits remain distinct from the evidence-grounded extraction snapshot.
  const updated = await client.from("resume_versions").update({ normalized_profile_json: { ...version.normalized_profile_json, chips: patch.chips, chips_user_edited: true }, is_user_approved: patch.use_for_matching }).eq("id", version.id).eq("base_resume_id", resume.id).eq("user_id", userId).select("id").single();
  dbError(updated.error);
  return ResumeView.parse({ ...resume, version_id: version.id, chips: patch.chips, use_for_matching: patch.use_for_matching });
}
export async function readBoundedBody(request: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const tooLarge = () => new JobError("INVALID_INPUT", "Request exceeds the supported size limit.", 413);
  if (Number(request.headers.get("content-length")) > max) throw tooLarge();
  if (!request.body) throw new JobError("INVALID_INPUT", "Missing request body.", 400);
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export async function readResumeFile(request: Request): Promise<File> {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new JobError("INVALID_INPUT", "Expected a multipart resume upload.", 400);
  const bytes = await readBoundedBody(request, MAX_FILE_BYTES + 64 * 1024);
  let form: FormData;
  try { form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData(); }
  catch { throw new JobError("INVALID_INPUT", "Invalid multipart upload.", 400); }
  const file = form.get("file");
  if (!(file instanceof File)) throw new JobError("INVALID_INPUT", "Choose a resume file.", 400);
  return file;
}
