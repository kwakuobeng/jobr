import { z } from "zod";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const PDF = "application/pdf";
export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const ResumeMime = z.enum([PDF, DOCX]);
export const Chips = z.object({
  skills: z.array(z.string().trim().min(1).max(80)).max(100),
  titles: z.array(z.string().trim().min(1).max(120)).max(20),
  years: z.number().min(0).max(80).nullable(),
}).strict();
export const ResumePatch = z.object({
  resume_id: z.string().uuid(), version_id: z.string().uuid(), chips: Chips, use_for_matching: z.boolean(),
}).strict();
export const ResumeView = z.object({
  id: z.string().uuid(), original_filename: z.string(), parse_status: z.enum(["pending", "processing", "completed", "failed"]),
  version_id: z.string().uuid().nullable(), chips: Chips.nullable(), use_for_matching: z.boolean(),
  years_source: z.enum(["explicit", "computed"]).nullable().optional(),
});
export type ChipsValue = z.infer<typeof Chips>;
export type ResumeValue = z.infer<typeof ResumeView>;
export function validateFile(file: { size: number; type: string; name: string }) {
  if (!ResumeMime.safeParse(file.type).success) throw new Error("Choose a PDF or DOCX resume.");
  if (!Number.isInteger(file.size) || file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error("Resume must be between 1 byte and 10 MiB.");
  if (!file.name.trim() || file.name.length > 255 || /[\u0000-\u001f]/.test(file.name)) throw new Error("Use a filename of 1–255 characters without control characters.");
}
export function storagePath(userId: string, resumeId: string, mime: string) {
  z.string().uuid().parse(userId); z.string().uuid().parse(resumeId);
  return `${userId}/${resumeId}/source.${ResumeMime.parse(mime) === PDF ? "pdf" : "docx"}`;
}
