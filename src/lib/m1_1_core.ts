// Jobr Milestone M1.1: Core Primitives, SSRF Guard & Tier-1 Public ATS Adapters
// Target: src/lib/m1_1_core.ts

import crypto from "node:crypto";

export {
  calculateNonOverlappingExperience,
  type DateIntervalInput,
  type MergedExperienceResult,
} from "./resume/experience-calculator";
export { verifyResumeQuoteSubstring } from "./resume/quote-verifier";

export function computeCanonicalIdentityHash(
  canonicalEmployerId: string,
  rawTitle: string,
  rawLocations: string[],
): string {
  const normalizedTitle = rawTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const sortedLocations = [...rawLocations]
    .map((loc) => loc.toLowerCase().trim())
    .sort()
    .join(",");
  return crypto
    .createHash("sha256")
    .update(`${canonicalEmployerId}|${normalizedTitle}|${sortedLocations}`)
    .digest("hex");
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
      .trim(),
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
    updatedAt: item.updated_at,
  };
}
