import { computeCanonicalIdentityHash } from "../m1_1_core";
import { normalizeApplyUrl } from "./deduplicator";
import { safeFetch, type SafeFetch } from "../http/safe_fetch";
import type { RawJobPayload } from "../../../specs/ingestion/zod_provider_schemas";
export interface DedupRecord {
  id: string;
  employerId: string;
  job: RawJobPayload;
  identityHash: string;
  firstSeenAt: string;
  lastSeenAt: string;
  repostCount: number;
}
export type DedupTier = 1 | 2 | 3 | 4 | "new";
const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const fuzzyKey = (job: RawJobPayload) =>
  JSON.stringify([
    normalize(job.rawEmployerName),
    normalize(job.rawTitle),
    [...new Set(job.rawLocations.map(normalize))].sort(),
  ]);
const time = (value: string) => {
  const n = Date.parse(value);
  if (!Number.isFinite(n)) throw new Error("Invalid dedup date");
  return n;
};
export function dedupJob(
  records: readonly DedupRecord[],
  job: RawJobPayload,
  employerId: string,
  nowIso: string,
  newId: string,
) {
  const now = time(nowIso),
    applyUrl = normalizeApplyUrl(job.applyUrl);
  const identityHash = computeCanonicalIdentityHash(
    employerId,
    job.rawTitle,
    job.rawLocations,
  );
  let tier: DedupTier = "new";
  // Tenant is part of source identity: external IDs can collide across employer boards.
  let match = records.find(
    (r) =>
      r.job.sourceProvider === job.sourceProvider &&
      r.job.sourceTenantSlug === job.sourceTenantSlug &&
      r.job.externalJobId === job.externalJobId,
  );
  if (match) tier = 1;
  if (!match) {
    match = records.find(
      (r) =>
        r.employerId === employerId &&
        normalizeApplyUrl(r.job.applyUrl) === applyUrl,
    );
    if (match) tier = 2;
  }
  if (!match) {
    match = records.find((r) => r.identityHash === identityHash);
    if (match) tier = 3;
  }
  if (!match) {
    match = records.find(
      (r) =>
        now >= time(r.lastSeenAt) &&
        now - time(r.lastSeenAt) <= 30 * 86400000 &&
        fuzzyKey(r.job) === fuzzyKey(job),
    );
    if (match) tier = 4;
  }
  if (match && match.employerId !== employerId && tier !== 4)
    throw new Error("Source employer identity changed");
  const newSource =
    match &&
    (match.job.externalJobId !== job.externalJobId ||
      match.job.sourceProvider !== job.sourceProvider ||
      match.job.sourceTenantSlug !== job.sourceTenantSlug);
  const isRepost = Boolean(
    match &&
      match.identityHash === identityHash &&
      newSource &&
      now - time(match.lastSeenAt) > 7 * 86400000,
  );
  const record: DedupRecord = match
    ? {
        ...match,
        job,
        lastSeenAt: nowIso,
        repostCount: match.repostCount + (isRepost ? 1 : 0),
      }
    : {
        id: newId,
        employerId,
        job,
        identityHash,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        repostCount: 0,
      };
  return {
    tier,
    isRepost,
    record,
    records: [...records.filter((r) => r.id !== record.id), record],
  };
}
export async function checkListingActive(
  url: string,
  http: SafeFetch = safeFetch,
): Promise<boolean> {
  const response = await http(url);
  if (response.status === 404 || response.status === 410) return false;
  if (response.status !== 200)
    throw new Error(
      `Listing verification inconclusive: HTTP ${response.status}`,
    );
  return true;
}
