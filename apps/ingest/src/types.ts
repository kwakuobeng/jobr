import { z } from "zod";
import type { RawJobPayload } from "../../../specs/ingestion/zod_provider_schemas.js";
export const BoardSchema = z
  .object({
    ats: z.enum(["greenhouse", "lever", "ashby", "smartrecruiters", "usajobs"]),
    token: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    company: z.string().min(1),
    source: z.string(),
    enabled: z.boolean().optional(),
    jobsAtVerify: z.number().optional(),
    note: z.string().optional(),
  })
  .passthrough();
export type AtsType = z.infer<typeof BoardSchema>["ats"];
export const BoardsSchema = z.array(BoardSchema);
export interface Board {
  ats: AtsType;
  token: string;
  company: string;
  source: string;
}
export interface JobListing {
  id: string; // `${ats}:${token}:${sourceJobId}` — primary dedupe key
  dedupeHash: string; // sha1(normalized company|title|location) — cross-source dedupe
  ats: AtsType;
  boardToken: string;
  sourceJobId: string;
  company: string;
  title: string;
  location: string;
  remote: boolean;
  department?: string;
  employmentType?: string;
  url: string;
  applyUrl?: string;
  postedAt?: string;
  updatedAt?: string;
  descriptionText?: string;
  rawPayload?: RawJobPayload;
  fetchedAt: string;
}
