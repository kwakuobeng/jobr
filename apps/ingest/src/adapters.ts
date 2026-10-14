import { createHash } from "node:crypto";
import { z } from "zod";
import {
  normalizeGreenhousePayload,
  normalizeLeverPayload,
  normalizeAshbyPayload,
  normalizeUsaJobsPayload,
  RawJobPayloadSchema,
  type RawJobPayload,
} from "../../../specs/ingestion/zod_provider_schemas.js";
import { safeFetch, type SafeFetch } from "../../../src/lib/http/safe_fetch.js";
import {
  BoardSchema,
  type AtsType,
  type Board,
  type JobListing,
} from "./types.js";
const UA = "JobrIngest/0.2 (public ATS discovery)";
export const ATS_HOSTS = [
  "boards-api.greenhouse.io",
  "api.lever.co",
  "api.ashbyhq.com",
  "api.smartrecruiters.com",
  "data.usajobs.gov",
] as const;
export interface AdapterOptions {
  http?: SafeFetch;
  env?: { USAJOBS_API_KEY?: string; USAJOBS_USER_AGENT_EMAIL?: string };
}
export async function getJson(
  url: string,
  tries = 3,
  options: AdapterOptions = {},
  headers: Record<string, string> = {},
): Promise<unknown> {
  if (!Number.isInteger(tries) || tries < 1 || tries > 3)
    throw new Error("Invalid retry count");
  for (let i = 0; ; i++) {
    const r = await (options.http ?? safeFetch)(url, {
      allowedHosts: ATS_HOSTS,
      headers: {
        "user-agent": UA,
        accept: "application/json",
        ...Object.fromEntries(
          Object.entries(headers).map(([key, value]) => [
            key.toLowerCase(),
            value,
          ]),
        ),
      },
    });
    if (r.status === 200) return JSON.parse(r.text) as unknown;
    if ((r.status === 429 || r.status >= 500) && i < tries - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (i + 1)));
      continue;
    }
    throw new Error(`Source returned HTTP ${r.status}`);
  }
}
export const stripHtml = (h = "") =>
  h
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const norm = (s = "") =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export const dedupeHash = (c: string, t: string, l: string) =>
  createHash("sha1")
    .update(`${norm(c)}|${norm(t)}|${norm(l)}`)
    .digest("hex")
    .slice(0, 16);
const token = (value: string) =>
  z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,100}$/)
    .parse(value);
export const endpoints: Record<AtsType, (t: string) => string> = {
  greenhouse: (t) =>
    `https://boards-api.greenhouse.io/v1/boards/${token(t)}/jobs?content=true`,
  lever: (t) => `https://api.lever.co/v0/postings/${token(t)}?mode=json`,
  ashby: (t) =>
    `https://api.ashbyhq.com/posting-api/job-board/${token(t)}?includeCompensation=true`,
  smartrecruiters: (t) =>
    `https://api.smartrecruiters.com/v1/companies/${token(t)}/postings?limit=100`,
  usajobs: (t) =>
    `https://data.usajobs.gov/api/search?Keyword=${encodeURIComponent(token(t))}`,
};
const SmartPosting = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string(),
  releasedDate: z.string().optional(),
  location: z
    .object({
      city: z.string().optional(),
      region: z.string().optional(),
      country: z.string().optional(),
      remote: z.boolean().optional(),
    })
    .optional(),
  department: z.object({ label: z.string() }).optional(),
  typeOfEmployment: z.object({ label: z.string() }).optional(),
});
const SmartPage = z.object({
  content: z.array(SmartPosting).default([]),
  totalFound: z.number().int().nonnegative().default(0),
});
export async function fetchRawBoard(
  input: Board,
  options: AdapterOptions = {},
): Promise<RawJobPayload[]> {
  const b = BoardSchema.parse(input);
  let headers: Record<string, string> = {};
  if (b.ats === "usajobs") {
    const env = options.env ?? process.env;
    const credentials = z
      .object({
        USAJOBS_API_KEY: z.string().min(1),
        USAJOBS_USER_AGENT_EMAIL: z.string().email(),
      })
      .parse(env);
    headers = {
      "Authorization-Key": credentials.USAJOBS_API_KEY,
      "User-Agent": credentials.USAJOBS_USER_AGENT_EMAIL,
    };
  }
  const d = await getJson(endpoints[b.ats](b.token), 3, options, headers);
  switch (b.ats) {
    case "greenhouse": {
      const jobs = normalizeGreenhousePayload(b.token, b.company, undefined, d);
      const original = z
        .object({ jobs: z.array(z.record(z.unknown())) })
        .parse(d).jobs;
      return jobs.map((job) => ({
        ...job,
        rawJson:
          original.find((raw) => String(raw.id) === job.externalJobId) ??
          job.rawJson,
      }));
    }
    case "lever":
      return normalizeLeverPayload(b.token, b.company, undefined, d);
    case "ashby":
      return normalizeAshbyPayload(b.token, b.company, undefined, d);
    case "usajobs":
      return normalizeUsaJobsPayload(d);
    case "smartrecruiters": {
      const page = SmartPage.parse(d),
        out = [...page.content];
      let offset = out.length;
      while (offset < page.totalFound && offset < 1000) {
        const next = SmartPage.parse(
          await getJson(
            `${endpoints.smartrecruiters(b.token)}&offset=${offset}`,
            3,
            options,
          ),
        );
        if (!next.content.length) break;
        out.push(...next.content);
        offset += next.content.length;
      }
      return out.slice(0, 1000).map((j) => {
        const location = [
          j.location?.city,
          j.location?.region,
          j.location?.country,
        ]
          .filter(Boolean)
          .join(", ");
        const url = `https://jobs.smartrecruiters.com/${b.token}/${encodeURIComponent(j.id)}`;
        return RawJobPayloadSchema.parse({
          sourceProvider: "smartrecruiters",
          sourceTenantSlug: b.token,
          externalJobId: j.id,
          canonicalUrl: url,
          applyUrl: url,
          rawTitle: j.name,
          rawEmployerName: b.company,
          rawDescriptionText: j.name,
          rawLocations: location ? [location] : [],
          rawWorkplaceType: j.location?.remote ? "remote" : "unspecified",
          publishedAt: j.releasedDate,
          rawJson: j,
        });
      });
    }
  }
}
function department(raw: Record<string, unknown>): string | undefined {
  const result = z
    .object({
      departments: z.array(z.object({ name: z.string() })).optional(),
      department: z
        .union([z.string(), z.object({ label: z.string() })])
        .nullish(),
      categories: z.object({ team: z.string().optional() }).optional(),
    })
    .safeParse(raw);
  if (!result.success) return undefined;
  const d = result.data.department;
  return (
    result.data.departments?.[0]?.name ??
    (typeof d === "string" ? d : d?.label) ??
    result.data.categories?.team
  );
}
// Retain PR #2's JobListing contract and CLI/Worker entrypoint while normalizing once,
// through Gemini's validated RawJobPayload. No parallel provider implementation.
export async function fetchBoard(
  b: Board,
  options: AdapterOptions = {},
): Promise<JobListing[]> {
  return (await fetchRawBoard(b, options)).map((job) => ({
    id: `${b.ats}:${b.token}:${job.externalJobId}`,
    dedupeHash: dedupeHash(
      b.company,
      job.rawTitle,
      job.rawLocations.join("; "),
    ),
    ats: b.ats,
    boardToken: b.token,
    company: b.company,
    sourceJobId: job.externalJobId,
    title: job.rawTitle,
    location: job.rawLocations.join("; "),
    remote: job.rawWorkplaceType === "remote",
    department: department(job.rawJson),
    employmentType: job.rawEmploymentType,
    url: job.canonicalUrl,
    applyUrl: job.applyUrl,
    postedAt: job.publishedAt,
    updatedAt: job.updatedAt,
    descriptionText: job.rawDescriptionText.slice(0, 6000),
    fetchedAt: new Date().toISOString(),
    rawPayload: job,
  }));
}
