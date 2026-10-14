export type AtsType = "greenhouse" | "lever" | "ashby" | "smartrecruiters";
export interface Board { ats: AtsType; token: string; company: string; source: string; }
export interface JobListing {
  id: string;            // `${ats}:${token}:${sourceJobId}` — primary dedupe key
  dedupeHash: string;    // sha1(normalized company|title|location) — cross-source dedupe
  ats: AtsType; boardToken: string; sourceJobId: string;
  company: string; title: string; location: string; remote: boolean;
  department?: string; employmentType?: string;
  url: string; applyUrl?: string;
  postedAt?: string; updatedAt?: string;
  descriptionText?: string;
  fetchedAt: string;
}
