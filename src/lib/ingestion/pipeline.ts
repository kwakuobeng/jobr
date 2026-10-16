/**
 * Hourly refresh pipeline (D6: Cron → Queue → consumer). Runtime-neutral: uses `fetch` only, so it
 * runs in the Cloudflare ingest worker and in Node scripts/tests. Writes go through the
 * service-role-only RPCs from migration 0009 (ingest_job_batch, merge_duplicate_postings,
 * close_stale_jobs). Free, official, keyless board APIs only (D8): Greenhouse, Ashby, Lever; USAJOBS
 * with its free key. No application submission (D7).
 */
import { z } from "zod";
import {
  normalizeAshbyPayload, normalizeGreenhousePayload, normalizeLeverPayload, normalizeUsaJobsPayload,
  type RawJobPayload,
} from "../../../specs/ingestion/zod_provider_schemas";
import { simhash } from "./deduplicator";
import type { HttpClient } from "./ssrf-client";
import { classifyLocations } from "../jobs/region";
import { jobEmbeddingText, sha256Hex, toVectorLiteral, EMBEDDING_MODEL, type Embedder } from "../embeddings";

export const SUPPORTED_PROVIDERS = ["greenhouse", "ashby", "lever", "usajobs"] as const;
export type Provider = (typeof SUPPORTED_PROVIDERS)[number];
export const BoardSchema = z.object({
  ats: z.enum(["greenhouse", "ashby"]),
  token: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  company: z.string().min(1).max(200),
  verifiedAt: z.string().optional(),
  httpStatusAtVerify: z.number().optional(),
  jobsAtVerify: z.number().optional(),
});
export type Board = z.infer<typeof BoardSchema>;
export const SourceSchema = z.object({
  id: z.string().uuid(),
  provider_type: z.string(),
  tenant_slug: z.string().nullable(),
  display_name: z.string().nullable(),
});
export type Source = z.infer<typeof SourceSchema>;
export const QueueMessageSchema = z.object({ sourceId: z.string().uuid() });

const HOSTS: Record<Provider, string> = {
  greenhouse: "boards-api.greenhouse.io", ashby: "api.ashbyhq.com", lever: "api.lever.co", usajobs: "data.usajobs.gov",
};
const MAX_BYTES = 5 * 1024 * 1024;
/** fetch-based GET client: HTTPS only, fixed host allowlist, no redirects, size + time limits. */
export function fetchClient(allowedHosts: readonly string[], fetchImpl: typeof fetch = fetch): HttpClient {
  return async (value, headers = {}) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !allowedHosts.includes(url.hostname))
      throw new Error(`Blocked URL host: ${url.hostname}`);
    const response = await fetchImpl(url.href, { method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    const declared = Number(response.headers.get("content-length"));
    if (declared > MAX_BYTES) {
      await response.body?.cancel();
      throw new Error("Response too large");
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) {
            await reader.cancel();
            throw new Error("Response too large");
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder().decode(bytes);
    const outHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => { outHeaders[k] = v; });
    return { status: response.status, headers: outHeaders, text };
  };
}
export const slugify = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";

export interface UsaJobsCredentials { apiKey: string; userAgent: string }
export interface FetchOptions { client?: HttpClient; usajobs?: UsaJobsCredentials; usajobsMaxPages?: number }
/** Pull one source and normalize to RawJobPayload. Greenhouse/Ashby/Lever are full-board snapshots. */
export async function fetchSourceJobs(source: Source, options: FetchOptions = {}): Promise<RawJobPayload[]> {
  const provider = source.provider_type as Provider;
  if (!SUPPORTED_PROVIDERS.includes(provider)) throw new Error(`Unsupported provider: ${source.provider_type}`);
  const client = options.client ?? fetchClient([HOSTS[provider]]);
  const tenant = source.tenant_slug ?? "";
  const employer = source.display_name ?? tenant;
  const get = async (url: string, headers: Record<string, string> = {}) => {
    const result = await client(url, headers);
    if (result.status !== 200) throw new Error(`${provider}/${tenant} returned HTTP ${result.status}`);
    return JSON.parse(result.text) as unknown;
  };
  if (provider === "usajobs") {
    if (!options.usajobs) throw new Error("USAJOBS credentials are not configured");
    const jobs: RawJobPayload[] = [];
    const maxPages = options.usajobsMaxPages ?? 4;
    for (let page = 1; page <= maxPages; page++) {
      const url = new URL("https://data.usajobs.gov/api/search");
      url.searchParams.set("ResultsPerPage", "500");
      url.searchParams.set("Page", String(page));
      if (tenant && tenant !== "usajobs-search") url.searchParams.set("Keyword", tenant);
      const batch = normalizeUsaJobsPayload(await get(url.href, { "Authorization-Key": options.usajobs.apiKey, "User-Agent": options.usajobs.userAgent }));
      jobs.push(...batch);
      if (batch.length < 500) break;
    }
    return jobs;
  }
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(tenant)) throw new Error("Invalid board token");
  if (provider === "greenhouse")
    return normalizeGreenhousePayload(tenant, employer, undefined, await get(`https://boards-api.greenhouse.io/v1/boards/${tenant}/jobs?content=true`));
  if (provider === "ashby")
    return normalizeAshbyPayload(tenant, employer, undefined, await get(`https://api.ashbyhq.com/posting-api/job-board/${tenant}?includeCompensation=true`));
  return normalizeLeverPayload(tenant, employer, undefined, await get(`https://api.lever.co/v0/postings/${tenant}?mode=json`));
}

export interface BatchRow {
  external_id: string; employer_name: string; employer_slug: string; employer_domain: string | null;
  title: string; title_slug: string; locations: string[]; workplace: string; employment: string;
  min_usd: number | null; max_usd: number | null; currency: string; description: string; simhash: string;
  posting_url: string; apply_url: string; published_at: string | null; raw_hash: string; country_codes: string[];
}
export async function toBatchRow(job: RawJobPayload): Promise<BatchRow> {
  const locations = [...new Set(job.rawLocations.map((l) => l.trim()).filter(Boolean))];
  const comp = job.rawCompensation;
  const raw_hash = await sha256Hex(JSON.stringify([job.rawTitle, job.rawDescriptionText, locations, comp ?? null, job.rawWorkplaceType]));
  const published = job.publishedAt && Number.isFinite(Date.parse(job.publishedAt)) ? new Date(job.publishedAt).toISOString() : null;
  return {
    external_id: job.externalJobId, employer_name: job.rawEmployerName, employer_slug: slugify(job.rawEmployerName),
    employer_domain: job.rawEmployerDomain ?? null, title: job.rawTitle, title_slug: slugify(job.rawTitle), locations,
    workplace: job.rawWorkplaceType, employment: job.rawEmploymentType,
    min_usd: comp?.minAnnualUsd ?? null, max_usd: comp?.maxAnnualUsd ?? null, currency: comp?.currency ?? "USD",
    description: job.rawDescriptionText, simhash: simhash(job.rawDescriptionText).toString(),
    posting_url: job.canonicalUrl, apply_url: job.applyUrl, published_at: published, raw_hash,
    country_codes: classifyLocations(locations).country_codes,
  };
}

/** Minimal slice of supabase-js used here (service-role client). */
export interface DbResult { data: unknown; error: { message: string } | null }
export interface DbQuery extends PromiseLike<DbResult> {
  select(columns: string): DbQuery;
  eq(column: string, value: unknown): DbQuery;
  is(column: string, value: null): DbQuery;
  order(column: string, options: { ascending: boolean }): DbQuery;
  limit(count: number): DbQuery;
  update(values: Record<string, unknown>): DbQuery;
  upsert(values: Record<string, unknown>[], options: { onConflict: string }): DbQuery;
  maybeSingle(): PromiseLike<DbResult>;
}
export interface Db {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: string): DbQuery;
}
const check = <T>(result: { data: T; error: { message: string } | null }, what: string): T => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
};

/** Upsert the curated board list into job_sources (active, hourly). Returns the source rows. */
export async function syncBoards(db: Db, boards: Board[]): Promise<Source[]> {
  const rows = boards.map((b) => ({
    provider_type: b.ats, tenant_slug: b.token, display_name: b.company,
    base_endpoint_url: b.ats === "greenhouse" ? `https://boards-api.greenhouse.io/v1/boards/${b.token}/jobs` : `https://api.ashbyhq.com/posting-api/job-board/${b.token}`,
    is_active: true, poll_interval_minutes: 60,
  }));
  if (rows.length) check(await db.from("job_sources").upsert(rows, { onConflict: "provider_type,tenant_slug" }), "sync job_sources");
  const data = check(await db.from("job_sources").select("id,provider_type,tenant_slug,display_name").eq("is_active", true), "load job_sources");
  return z.array(SourceSchema).parse(data).filter((s) => (SUPPORTED_PROVIDERS as readonly string[]).includes(s.provider_type));
}

export interface RunResult { sourceId: string; fetched: number; inserted: number; merged: number; updated: number }
/** Pull one source and write it in ≤500-row pages. Failures bump consecutive_failures and rethrow (queue retry). */
export async function runSource(db: Db, source: Source, options: FetchOptions = {}): Promise<RunResult> {
  try {
    const jobs = await fetchSourceJobs(source, options);
    const rows = await Promise.all(jobs.map(toBatchRow));
    const total = { sourceId: source.id, fetched: rows.length, inserted: 0, merged: 0, updated: 0 };
    for (let i = 0; i < rows.length; i += 500) {
      const data = check(await db.rpc("ingest_job_batch", { p_job_source_id: source.id, p_jobs: rows.slice(i, i + 500) }), "ingest_job_batch");
      const [counts] = z.array(z.object({ inserted: z.number(), merged: z.number(), updated: z.number() })).parse(data);
      if (counts) { total.inserted += counts.inserted; total.merged += counts.merged; total.updated += counts.updated; }
    }
    return total;
  } catch (error) {
    await db.rpc("record_source_failure", { p_job_source_id: source.id });
    throw error;
  }
}

const PendingJob = z.object({
  id: z.string(), title: z.string(), employer_name: z.string(),
  extracted_required_skills: z.array(z.string()).nullable(), description_plain: z.string().nullable(),
});
/** Embed active, un-merged jobs that have no embedding yet (bounded per call). */
export async function embedPendingJobs(db: Db, embed: Embedder, limit = 100): Promise<number> {
  const data = check(await db.from("canonical_jobs").select("id,title,employer_name,extracted_required_skills,description_plain")
    .eq("status", "active").is("duplicate_of", null).is("requirements_embedding", null).order("first_discovered_at", { ascending: false }).limit(limit), "load pending jobs");
  const jobs = z.array(PendingJob).parse(data);
  if (!jobs.length) return 0;
  const texts = jobs.map(jobEmbeddingText);
  const vectors = await embed(texts);
  for (const [i, job] of jobs.entries()) {
    check(await db.from("canonical_jobs").update({
      requirements_embedding: toVectorLiteral(vectors[i]!), embedding_model: EMBEDDING_MODEL,
      embedding_source_hash: await sha256Hex(texts[i]!), embedded_at: new Date().toISOString(),
    }).eq("id", job.id), "store job embedding");
  }
  return jobs.length;
}
