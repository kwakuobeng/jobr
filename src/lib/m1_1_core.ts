// Jobr Milestone M1.1: Core Primitives, SSRF Guard & Tier-1 Public ATS Adapters
// Target: src/lib/m1_1_core.ts
  
import crypto from 'node:crypto';
  
export interface DateIntervalInput {
  id: string;
  startDate: string; // YYYY-MM-DD
  endDate: string | null;
  isCurrent: boolean;
  isInternship: boolean;
}
  
export interface MergedExperienceResult {
  totalProfessionalMonths: number;
  totalInternshipMonths: number;
  mergedIntervals: Array<{ startMonthIndex: number; endMonthIndex: number; durationMonths: number }>;
}
  
function toMonthIndex(isoDate: string): number {
  const [yearStr, monthStr] = isoDate.split('-');
  const year = Number.parseInt(yearStr ?? '0', 10);
  const month = Number.parseInt(monthStr ?? '1', 10);
  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    throw new Error(`Invalid ISO date string: ${isoDate}`);
  }
  return year * 12 + (month - 1);
}
  
export function calculateNonOverlappingExperience(
  intervals: DateIntervalInput[],
  referenceIsoDate = '2026-10-14'
): MergedExperienceResult {
  const refMonth = toMonthIndex(referenceIsoDate);
  
  const mergeGroup = (group: DateIntervalInput[]) => {
    const normalized = group
      .map((item) => {
        const start = toMonthIndex(item.startDate);
        const end = item.isCurrent || !item.endDate ? refMonth : toMonthIndex(item.endDate);
        return { startMonthIndex: Math.min(start, end), endMonthIndex: Math.max(start, end) };
      })
      .sort((a, b) => a.startMonthIndex - b.startMonthIndex || a.endMonthIndex - b.endMonthIndex);
  
    const merged: Array<{ startMonthIndex: number; endMonthIndex: number; durationMonths: number }> = [];
    for (const current of normalized) {
      const last = merged[merged.length - 1];
      if (!last || current.startMonthIndex > last.endMonthIndex) {
        merged.push({
          ...current,
          durationMonths: Math.max(1, current.endMonthIndex - current.startMonthIndex + 1),
        });
      } else {
        last.endMonthIndex = Math.max(last.endMonthIndex, current.endMonthIndex);
        last.durationMonths = Math.max(1, last.endMonthIndex - last.startMonthIndex + 1);
      }
    }
    return merged;
  };
  
  const proMerged = mergeGroup(intervals.filter((i) => !i.isInternship));
  const internMerged = mergeGroup(intervals.filter((i) => i.isInternship));
  
  return {
    totalProfessionalMonths: proMerged.reduce((sum, i) => sum + i.durationMonths, 0),
    totalInternshipMonths: internMerged.reduce((sum, i) => sum + i.durationMonths, 0),
    mergedIntervals: proMerged,
  };
}
  
export function verifyResumeQuoteSubstring(rawResumeText: string, verbatimQuote: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  const normRaw = normalize(rawResumeText);
  const normQuote = normalize(verbatimQuote);
  return normQuote.length >= 6 && normRaw.includes(normQuote);
}
  
export function computeCanonicalIdentityHash(
  canonicalEmployerId: string,
  rawTitle: string,
  rawLocations: string[]
): string {
  const normalizedTitle = rawTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const sortedLocations = [...rawLocations]
    .map((loc) => loc.toLowerCase().trim())
    .sort()
    .join(',');
  return crypto
    .createHash('sha256')
    .update(`${canonicalEmployerId}|${normalizedTitle}|${sortedLocations}`)
    .digest('hex');
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
  
export function normalizeGreenhouseJob(boardToken: string, employerName: string, item: GreenhouseJobItem) {
  const firstPay = item.pay_input_ranges?.[0];
  return {
    sourceProvider: 'greenhouse' as const,
    sourceTenantSlug: boardToken,
    externalJobId: String(item.id),
    canonicalUrl: item.absolute_url,
    applyUrl: item.absolute_url,
    rawTitle: item.title,
    rawEmployerName: employerName,
    rawDescriptionHtml: item.content ?? '',
    rawDescriptionText: (item.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    rawLocations: item.location?.name ? [item.location.name] : [],
    rawCompensation: firstPay
      ? {
          currency: firstPay.currency_type ?? 'USD',
          interval: 'year' as const,
          minAmount: firstPay.min_cents ? Math.round(firstPay.min_cents / 100) : undefined,
          maxAmount: firstPay.max_cents ? Math.round(firstPay.max_cents / 100) : undefined,
        }
      : undefined,
    updatedAt: item.updated_at,
  };
}
  