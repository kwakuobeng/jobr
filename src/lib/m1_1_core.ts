// Jobr Milestone M1.1: Core Primitives, SSRF Guard & Tier-1 Public ATS Adapters
// Target: src/lib/m1_1_core.ts

import crypto from "node:crypto";

export {
  calculateNonOverlappingExperience,
  type DateIntervalInput,
  type MergedExperienceResult,
} from "./resume/experience-calculator";
export { verifyResumeQuoteSubstring } from "./resume/quote-verifier";

export interface OpeningIdentity {
  provider: string;
  tenant?: string | null;
  externalJobId: string;
  requisitionId?: string | null;
}

/**
 * Without `opening`: the employer|title|locations fingerprint used by the dedup tiers
 * (cross-provider fuzzy merge and repost detection); unchanged so those keep working.
 * With `opening`: a per-opening identity that also binds provider, tenant, external job id and
 * (when present) requisition id, so distinct openings with the same title and location do not
 * collide on canonical_jobs.identity_hash (UNIQUE). Use this form when persisting.
 */
export function computeCanonicalIdentityHash(
  canonicalEmployerId: string,
  rawTitle: string,
  rawLocations: string[],
  opening?: OpeningIdentity,
): string {
  const normalizedTitle = rawTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const sortedLocations = [...rawLocations]
    .map((loc) => loc.toLowerCase().trim())
    .sort()
    .join(",");
  const base = `${canonicalEmployerId}|${normalizedTitle}|${sortedLocations}`;
  if (opening && !opening.externalJobId.trim())
    throw new Error("Opening identity requires an external job id");
  const material = opening
    ? `${base}|${JSON.stringify([
        opening.provider.toLowerCase(),
        (opening.tenant ?? "").toLowerCase(),
        opening.externalJobId.trim(),
        opening.requisitionId?.trim() ?? "",
      ])}`
    : base;
  return crypto.createHash("sha256").update(material).digest("hex");
}

export interface GreenhouseJobItem {
  id: number;
  internal_job_id: number | null;
  title: string;
  updated_at: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  pay_input_ranges?: Array<{
    min_cents?: number;
    max_cents?: number;
    currency_type?: string;
  }>;
}

export function normalizeGreenhouseJob(
  boardToken: string,
  employerName: string,
  item: GreenhouseJobItem,
) {
  const firstPay = item.pay_input_ranges?.[0];
  return {
    sourceProvider: "greenhouse" as const,
    sourceTenantSlug: boardToken,
    externalJobId: String(item.id),
    canonicalUrl: item.absolute_url,
    applyUrl: item.absolute_url,
    rawTitle: item.title,
    rawEmployerName: employerName,
    rawDescriptionHtml: item.content ?? "",
    rawDescriptionText: (item.content ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim() || item.title,
    rawLocations: item.location?.name ? [item.location.name] : [],
    rawCompensation: firstPay
      ? {
          currency: firstPay.currency_type ?? "USD",
          interval: "year" as const,
          minAmount:
            firstPay.min_cents !== undefined
              ? firstPay.min_cents / 100
              : undefined,
          maxAmount:
            firstPay.max_cents !== undefined
              ? firstPay.max_cents / 100
              : undefined,
        }
      : undefined,
    rawJson: { ...item },
    updatedAt: item.updated_at,
  };
}
