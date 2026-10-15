import { z } from "zod";
export const BoardSchema = z.object({
  ats: z.enum(["greenhouse", "lever", "ashby", "smartrecruiters"]),
  token: z.string().regex(/^[a-zA-Z0-9_-]+$/), company: z.string().min(1),
  source: z.string(), enabled: z.boolean().optional(),
  jobsAtVerify: z.number().default(0), verifiedAt: z.string().optional(), note: z.string().optional(),
});
export const BoardsSchema = z.array(BoardSchema);
export type AtsType = z.infer<typeof BoardSchema>["ats"];
export type Board = z.input<typeof BoardSchema>;
export const JobListingSchema = z.object({
  id: z.string(), dedupeHash: z.string(), ats: BoardSchema.shape.ats,
  boardToken: z.string(), sourceJobId: z.string(), company: z.string(), title: z.string(),
  location: z.string(), remote: z.boolean(), department: z.string().optional(),
  employmentType: z.string().optional(), url: z.string().url(), applyUrl: z.string().url().optional(),
  postedAt: z.string().optional(), updatedAt: z.string().optional(),
  descriptionText: z.string().optional(), fetchedAt: z.string(),
});
export type JobListing = z.infer<typeof JobListingSchema>;
