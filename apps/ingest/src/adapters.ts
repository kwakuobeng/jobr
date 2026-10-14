import { createHash } from "node:crypto";
import type { AtsType, Board, JobListing } from "./types.js";

const UA = "JobrIngest/0.1 (personal job-search assistant; contact via repo owner)";
export async function getJson(url: string, tries = 3): Promise<any> {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && i < tries - 1) { await new Promise(s => setTimeout(s, 1500 * (i + 1))); continue; }
    throw new Error(`HTTP ${r.status} ${url}`);
  }
}
export const stripHtml = (h = "") => h.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g," ").replace(/\s+/g, " ").trim();
const norm = (s = "") => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const dedupeHash = (c: string, t: string, l: string) => createHash("sha1").update(`${norm(c)}|${norm(t)}|${norm(l)}`).digest("hex").slice(0, 16);
const isRemote = (...s: (string|undefined)[]) => /remote|anywhere|distributed/i.test(s.filter(Boolean).join(" "));

function mk(b: Board, p: Omit<JobListing,"id"|"dedupeHash"|"ats"|"boardToken"|"company"|"fetchedAt">): JobListing {
  return { id: `${b.ats}:${b.token}:${p.sourceJobId}`, dedupeHash: dedupeHash(b.company, p.title, p.location),
    ats: b.ats, boardToken: b.token, company: b.company, fetchedAt: new Date().toISOString(), ...p,
    descriptionText: p.descriptionText?.slice(0, 6000) };
}

export const endpoints: Record<AtsType, (t: string) => string> = {
  greenhouse: t => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=true`,
  lever: t => `https://api.lever.co/v0/postings/${t}?mode=json`,
  ashby: t => `https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=true`,
  smartrecruiters: t => `https://api.smartrecruiters.com/v1/companies/${t}/postings?limit=100`,
};

export async function fetchBoard(b: Board): Promise<JobListing[]> {
  const d = await getJson(endpoints[b.ats](b.token));
  switch (b.ats) {
    case "greenhouse": return (d.jobs ?? []).map((j: any) => mk(b, { sourceJobId: String(j.id), title: j.title,
      location: j.location?.name ?? "", remote: isRemote(j.location?.name), department: j.departments?.[0]?.name,
      url: j.absolute_url, updatedAt: j.updated_at, postedAt: j.first_published, descriptionText: stripHtml(j.content) }));
    case "lever": return (Array.isArray(d) ? d : []).map((j: any) => mk(b, { sourceJobId: j.id, title: j.text,
      location: j.categories?.location ?? (j.categories?.allLocations ?? []).join("; "), remote: j.workplaceType === "remote" || isRemote(j.categories?.location),
      department: j.categories?.team, employmentType: j.categories?.commitment, url: j.hostedUrl, applyUrl: j.applyUrl,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined, descriptionText: j.descriptionPlain ?? stripHtml(j.description) }));
    case "ashby": return (d.jobs ?? []).filter((j: any) => j.isListed !== false).map((j: any) => mk(b, { sourceJobId: j.id, title: j.title,
      location: j.location ?? "", remote: !!j.isRemote || isRemote(j.location), department: j.department, employmentType: j.employmentType,
      url: j.jobUrl, applyUrl: j.applyUrl, postedAt: j.publishedAt, descriptionText: j.descriptionPlain ?? stripHtml(j.descriptionHtml) }));
    case "smartrecruiters": {
      const out: any[] = [...(d.content ?? [])]; let off = out.length;
      while (off < (d.totalFound ?? 0) && off < 1000) { // paginate, cap 1000
        const n = await getJson(`${endpoints.smartrecruiters(b.token)}&offset=${off}`); if (!n.content?.length) break; out.push(...n.content); off += n.content.length; }
      return out.map((j: any) => { const loc = [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(", ");
        return mk(b, { sourceJobId: j.id, title: j.name, location: loc, remote: !!j.location?.remote || isRemote(loc),
          department: j.department?.label, employmentType: j.typeOfEmployment?.label,
          url: `https://jobs.smartrecruiters.com/${b.token}/${j.id}`, postedAt: j.releasedDate }); });
    }
  }
}
