import { z } from "zod";
import {
  RawJobPayloadSchema,
  annualizeCompensation,
  compensationInterval,
} from "../../../../specs/ingestion/zod_provider_schemas";
import { safeGet, type HttpClient } from "../ssrf-client";
import { verifyUrlActive } from "../verifier";
import type { JobSourceAdapter, SyncWatermark } from "../types";
import { SourceHttpError } from "./public-board";
const Posting = z.object({
  "@type": z.union([
    z.literal("JobPosting"),
    z.array(z.string()).refine((a) => a.includes("JobPosting")),
  ]),
  title: z.string().min(1),
  description: z.string().min(1),
  url: z.string().url().optional(),
  identifier: z.union([z.string(), z.object({ value: z.string() })]).optional(),
  hiringOrganization: z.object({ name: z.string().min(1) }),
  jobLocationType: z.string().optional(),
  jobLocation: z
    .union([
      z.object({
        address: z.object({
          addressLocality: z.string().optional(),
          addressRegion: z.string().optional(),
          addressCountry: z.string().optional(),
        }),
      }),
      z.array(
        z.object({
          address: z.object({
            addressLocality: z.string().optional(),
            addressRegion: z.string().optional(),
            addressCountry: z.string().optional(),
          }),
        }),
      ),
    ])
    .optional(),
  datePosted: z.string().optional(),
  validThrough: z.string().optional(),
  baseSalary: z
    .object({
      currency: z.string(),
      value: z.object({
        minValue: z.number().optional(),
        maxValue: z.number().optional(),
        value: z.number().optional(),
        unitText: z.string(),
      }),
    })
    .optional(),
});
function collect(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(collect);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if ("@graph" in object) return collect(object["@graph"]);
    if (
      object["@type"] === "JobPosting" ||
      (Array.isArray(object["@type"]) && object["@type"].includes("JobPosting"))
    )
      return [object];
  }
  return [];
}
export function normalizeJsonLd(html: string, pageUrl: string) {
  const scripts = [
    ...html.matchAll(
      /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
    ),
  ];
  return scripts
    .flatMap((match) => collect(JSON.parse(match[1]!)))
    .map((value) => {
      const job = Posting.parse(value),
        salary = job.baseSalary;
      const interval = compensationInterval(salary?.value.unitText);
      const locations = !job.jobLocation
        ? []
        : Array.isArray(job.jobLocation)
          ? job.jobLocation
          : [job.jobLocation];
      const min = salary?.value.minValue ?? salary?.value.value,
        max = salary?.value.maxValue ?? salary?.value.value;
      const canonicalUrl = job.url ? new URL(job.url, pageUrl).href : pageUrl;
      return RawJobPayloadSchema.parse({
        sourceProvider: "user_url",
        externalJobId:
          typeof job.identifier === "string"
            ? job.identifier
            : (job.identifier?.value ?? canonicalUrl),
        canonicalUrl,
        applyUrl: canonicalUrl,
        rawTitle: job.title,
        rawEmployerName: job.hiringOrganization.name,
        rawDescriptionHtml: job.description,
        rawDescriptionText: job.description
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
        rawLocations: locations.map((l) =>
          [
            l.address.addressLocality,
            l.address.addressRegion,
            l.address.addressCountry,
          ]
            .filter(Boolean)
            .join(", "),
        ),
        rawWorkplaceType:
          job.jobLocationType === "TELECOMMUTE" ? "remote" : "unspecified",
        rawCompensation: salary
          ? {
              currency: salary.currency,
              interval,
              minAmount: min,
              maxAmount: max,
              minAnnualUsd:
                salary.currency === "USD"
                  ? annualizeCompensation(min, interval)
                  : undefined,
              maxAnnualUsd:
                salary.currency === "USD"
                  ? annualizeCompensation(max, interval)
                  : undefined,
            }
          : undefined,
        publishedAt: job.datePosted,
        validThrough: job.validThrough,
        rawJson: job,
      });
    });
}
export class JsonLdUrlAdapter implements JobSourceAdapter {
  readonly providerName = "user_url" as const;
  constructor(private client: HttpClient = safeGet) {}
  async fetchIncremental(
    _watermark: SyncWatermark | null,
    config: Record<string, unknown>,
  ) {
    const url = z.string().url().parse(config.url);
    const result = await this.client(url);
    if (result.status !== 200) throw new SourceHttpError(result.status);
    return {
      jobs: normalizeJsonLd(result.text, url),
      nextWatermark: { lastSyncedAt: new Date().toISOString() },
    };
  }
  async verifyListingActive(externalJobId: string, canonicalUrl: string) {
    const active = await verifyUrlActive(canonicalUrl, undefined, this.client);
    if (!active.isActive) return active;
    const { jobs } = await this.fetchIncremental(null, { url: canonicalUrl });
    const job = jobs.find((j) => j.externalJobId === externalJobId);
    if (!job)
      return {
        isActive: false,
        httpStatus: 200,
        closedReason: "ats_unlisted" as const,
      };
    if (job.validThrough)
      return verifyUrlActive(canonicalUrl, job.validThrough, this.client);
    return active;
  }
}
