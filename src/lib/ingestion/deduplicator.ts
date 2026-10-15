import { createHash } from "node:crypto";
import { computeCanonicalIdentityHash } from "../m1_1_core";
import type { RawJobPayload } from "./types";
export function normalizeApplyUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Invalid apply URL");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|gh_src|lever-source|source|ref)$/i.test(key))
      url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href;
}
function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}
export function jaccard(a: string, b: string): number {
  const x = tokens(a),
    y = tokens(b);
  if (!x.size || !y.size) return 0;
  const intersection = [...x].filter((t) => y.has(t)).length;
  return intersection / (x.size + y.size - intersection);
}
/** 64-bit simhash as a SIGNED int64, so it fits Postgres BIGINT (canonical_jobs.description_simhash). */
export function simhash(text: string): bigint {
  const sums = Array<number>(64).fill(0);
  for (const token of tokens(text)) {
    const hash = BigInt(
      `0x${createHash("sha256").update(token).digest("hex").slice(0, 16)}`,
    );
    for (let bit = 0; bit < 64; bit++)
      sums[bit] = sums[bit]! + (hash & (1n << BigInt(bit)) ? 1 : -1);
  }
  return BigInt.asIntN(
    64,
    sums.reduce(
      (hash, count, bit) => (count > 0 ? hash | (1n << BigInt(bit)) : hash),
      0n,
    ),
  );
}
export function hamming(a: bigint, b: bigint): number {
  // Compare as unsigned 64-bit: signed (negative) inputs would otherwise never reach 0 below.
  let value = BigInt.asUintN(64, a ^ b),
    count = 0;
  while (value) {
    count++;
    value &= value - 1n;
  }
  return count;
}
export interface CanonicalRecord {
  id: string;
  employerId: string;
  identityHash: string;
  description: string;
  applyUrl: string;
  status: "active" | "closed";
  originalPublishedAt: string;
  lastSeenAt: string;
  repostCount: number;
  latestRepostedAt?: string;
  ghostRiskScore: number;
}
export interface DiscoveryEvent {
  sourceKey: string;
  canonicalJobId: string;
  lastSeenAt: string;
}
export interface DedupState {
  jobs: CanonicalRecord[];
  events: DiscoveryEvent[];
}
export function sourceKey(job: RawJobPayload): string {
  return JSON.stringify([
    job.sourceProvider,
    job.sourceTenantSlug ?? "",
    job.externalJobId,
  ]);
}
export function deduplicate(
  state: DedupState,
  input: RawJobPayload,
  employerId: string,
  nowIso: string,
  newId: string,
): { state: DedupState; job: CanonicalRecord; tier: 1 | 2 | 3 | 4 | "new" } {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) throw new Error("Invalid ingestion date");
  const key = sourceKey(input),
    url = normalizeApplyUrl(input.applyUrl);
  const identityHash = computeCanonicalIdentityHash(
    employerId,
    input.rawTitle,
    [...new Set(input.rawLocations.map((s) => s.trim().toLowerCase()))],
  );
  const sighting = state.events.find((e) => e.sourceKey === key);
  let existing = sighting
    ? state.jobs.find((j) => j.id === sighting.canonicalJobId)
    : undefined;
  if (sighting && !existing) throw new Error("Orphan discovery event");
  if (existing && existing.employerId !== employerId)
    throw new Error("Source employer identity changed");
  let tier: 1 | 2 | 3 | 4 | "new" = existing ? 1 : "new";
  if (!existing) {
    existing = state.jobs.find(
      (j) => j.employerId === employerId && j.applyUrl === url,
    );
    if (existing) tier = 2;
  }
  const similar = (j: CanonicalRecord) =>
    Boolean(j.description.trim() && input.rawDescriptionText.trim()) &&
    (jaccard(j.description, input.rawDescriptionText) >= 0.85 ||
      hamming(simhash(j.description), simhash(input.rawDescriptionText)) <= 3);
  if (!existing) {
    existing = state.jobs.find(
      (j) =>
        j.identityHash === identityHash &&
        j.status === "active" &&
        now - Date.parse(j.lastSeenAt) <= 60 * 86400000 &&
        similar(j),
    );
    if (existing) tier = 3;
  }
  if (!existing) {
    existing = state.jobs.find(
      (j) =>
        j.identityHash === identityHash && j.status === "closed" && similar(j),
    );
    if (existing) tier = 4;
  }
  const isRepost = existing?.status === "closed";
  if (isRepost) tier = 4;
  const published =
    input.publishedAt && Number.isFinite(Date.parse(input.publishedAt))
      ? new Date(Math.min(now, Date.parse(input.publishedAt))).toISOString()
      : nowIso;
  const job: CanonicalRecord = existing
    ? {
        ...existing,
        status: "active",
        lastSeenAt: nowIso,
        applyUrl: url,
        description: input.rawDescriptionText,
        repostCount: existing.repostCount + (isRepost ? 1 : 0),
        ...(isRepost ? { latestRepostedAt: nowIso } : {}),
      }
    : {
        id: newId,
        employerId,
        identityHash,
        description: input.rawDescriptionText,
        applyUrl: url,
        status: "active",
        originalPublishedAt: published,
        lastSeenAt: nowIso,
        repostCount: 0,
        ghostRiskScore: 0,
      };
  job.ghostRiskScore =
    now - Date.parse(job.originalPublishedAt) > 60 * 86400000 ||
    job.repostCount >= 3
      ? 0.8
      : 0;
  return {
    job,
    tier,
    state: {
      jobs: [...state.jobs.filter((j) => j.id !== job.id), job],
      events: [
        ...state.events.filter((e) => e.sourceKey !== key),
        { sourceKey: key, canonicalJobId: job.id, lastSeenAt: nowIso },
      ],
    },
  };
}
export function shouldSuppressRecommendation(
  decision: {
    canonicalJobId: string;
    identityHash: string;
    salaryAtDecision?: number;
  },
  job: { id: string; identityHash: string; salary?: number },
  explicitlyReevaluate = false,
): boolean {
  if (explicitlyReevaluate) return false;
  if (
    decision.canonicalJobId !== job.id &&
    decision.identityHash !== job.identityHash
  )
    return false;
  if (
    decision.salaryAtDecision &&
    job.salary !== undefined &&
    job.salary >= decision.salaryAtDecision * 1.1
  )
    return false;
  return true;
}
