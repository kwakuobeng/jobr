// Jobr Milestone M1.1: Tier-1 Job Source Zod Schemas & Canonical Normalizers
// File: specs/ingestion/zod_provider_schemas.ts
// Covers: Greenhouse, Ashby (strictly filtering isListed: true), Lever, USAJOBS, and schema.org/JobPosting JSON-LD

import { z } from "zod";
const httpsUrl = z
  .string()
  .url()
  .refine((value) => {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  }, "HTTPS URL required");

export const RawCompensationSchema = z.object({
  currency: z.string().default("USD"),
  interval: z.enum(["year", "month", "week", "day", "hour"]).default("year"),
  minAmount: z.number().nonnegative().optional(),
  maxAmount: z.number().nonnegative().optional(),
  minAnnualUsd: z.number().int().nonnegative().optional(),
  maxAnnualUsd: z.number().int().nonnegative().optional(),
  rawText: z.string().optional(),
});

export const RawJobPayloadSchema = z.object({
  sourceProvider: z.enum([
    "greenhouse",
    "lever",
    "ashby",
    "smartrecruiters",
    "recruitee",
    "usajobs",
    "user_url",
  ]),
  sourceTenantSlug: z.string().optional(),
  externalJobId: z.string().min(1),
  canonicalUrl: httpsUrl,
  applyUrl: httpsUrl,
  rawTitle: z.string().min(1),
  rawEmployerName: z.string().min(1),
  rawEmployerDomain: z.string().optional(),
  rawDescriptionHtml: z.string().optional(),
  rawDescriptionText: z.string().min(1),
  rawLocations: z.array(z.string()),
  rawWorkplaceType: z
    .enum(["remote", "hybrid", "onsite", "unspecified"])
    .default("unspecified"),
  rawEmploymentType: z
    .enum(["full_time", "part_time", "contract", "internship", "temporary"])
    .default("full_time"),
  rawCompensation: RawCompensationSchema.optional(),
  publishedAt: z.string().optional(),
  updatedAt: z.string().optional(),
  validThrough: z.string().optional(),
  screeningQuestionsSchema: z.record(z.unknown()).optional(),
  complianceMetadata: z.record(z.unknown()).optional(),
  rawJson: z.record(z.unknown()),
});

export type RawJobPayload = z.infer<typeof RawJobPayloadSchema>;

function stripHtml(html: string): string {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function compensationInterval(
  value?: string,
): "year" | "month" | "week" | "day" | "hour" {
  const v = (value ?? "").toLowerCase();
  if (v.includes("hour")) return "hour";
  if (v.includes("month")) return "month";
  if (v.includes("week")) return "week";
  if (v.includes("day")) return "day";
  return "year";
}

export function annualizeCompensation(
  amount: number | undefined,
  interval: "year" | "month" | "week" | "day" | "hour",
): number | undefined {
  if (amount === undefined || !Number.isFinite(amount) || amount < 0)
    return undefined;
  switch (interval) {
    case "year":
      return Math.round(amount);
    case "month":
      return Math.round(amount * 12);
    case "week":
      return Math.round(amount * 52);
    case "day":
      return Math.round(amount * 260);
    case "hour":
      return Math.round(amount * 2080);
  }
}

// ============================================================================
// 1. GREENHOUSE JOB BOARD API SCHEMA & NORMALIZER
// Endpoint: GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true
// ============================================================================

export const GreenhouseJobPostSchema = z.object({
  id: z.number().int(),
  internal_job_id: z.number().int().nullable().optional(),
  title: z.string().min(1),
  updated_at: z.string(),
  first_published: z.string().optional(),
  requisition_id: z.string().nullable().optional(),
  absolute_url: z.string().url(),
  location: z
    .object({
      name: z.string().optional(),
    })
    .optional(),
  content: z.string().optional(),
  pay_input_ranges: z
    .array(
      z.object({
        min_cents: z.number().int().nullable().optional(),
        max_cents: z.number().int().nullable().optional(),
        currency_type: z.string().optional(),
        title: z.string().optional(),
        blurb: z.string().optional(),
      }),
    )
    .optional(),
  questions: z.array(z.record(z.unknown())).optional(),
  data_compliance: z.array(z.record(z.unknown())).optional(),
  // Live Greenhouse boards send explicit nulls for these (QA 2026-10-15).
  include_ai_disclaimer: z.boolean().nullable().optional(),
  ai_opt_out_request_url: z.string().nullable().optional(),
});

export const GreenhouseBoardResponseSchema = z.object({
  jobs: z.array(GreenhouseJobPostSchema),
  meta: z.object({ total: z.number().int().optional() }).optional(),
});

export function normalizeGreenhousePayload(
  boardToken: string,
  employerName: string,
  employerDomain: string | undefined,
  rawResponse: unknown,
): RawJobPayload[] {
  const parsed = GreenhouseBoardResponseSchema.parse(rawResponse);
  return parsed.jobs
    .filter((job) => job.internal_job_id !== null) // Exclude prospect-only placeholder posts
    .map((job) => {
      const pay = job.pay_input_ranges?.[0];
      const minUsd =
        pay?.min_cents !== undefined && pay.min_cents !== null
          ? pay.min_cents / 100
          : undefined;
      const maxUsd =
        pay?.max_cents !== undefined && pay.max_cents !== null
          ? pay.max_cents / 100
          : undefined;
      const locName = job.location?.name ?? "";
      const workplaceType: RawJobPayload["rawWorkplaceType"] = /remote/i.test(
        locName,
      )
        ? "remote"
        : /hybrid/i.test(locName)
          ? "hybrid"
          : locName
            ? "onsite"
            : "unspecified";

      return RawJobPayloadSchema.parse({
        sourceProvider: "greenhouse",
        sourceTenantSlug: boardToken,
        externalJobId: String(job.id),
        canonicalUrl: job.absolute_url,
        applyUrl: job.absolute_url,
        rawTitle: job.title,
        rawEmployerName: employerName,
        rawEmployerDomain: employerDomain,
        rawDescriptionHtml: job.content ?? "",
        rawDescriptionText: stripHtml(job.content ?? "") || job.title,
        rawLocations: locName ? [locName] : [],
        rawWorkplaceType: workplaceType,
        rawEmploymentType: "full_time",
        rawCompensation:
          minUsd !== undefined || maxUsd !== undefined
            ? {
                currency: pay?.currency_type ?? "USD",
                interval: "year",
                minAmount: minUsd,
                maxAmount: maxUsd,
                minAnnualUsd:
                  pay?.currency_type === "USD"
                    ? annualizeCompensation(minUsd, "year")
                    : undefined,
                maxAnnualUsd:
                  pay?.currency_type === "USD"
                    ? annualizeCompensation(maxUsd, "year")
                    : undefined,
              }
            : undefined,
        publishedAt: job.first_published,
        updatedAt: job.updated_at,
        screeningQuestionsSchema: job.questions
          ? { questions: job.questions }
          : undefined,
        complianceMetadata: {
          data_compliance: job.data_compliance ?? [],
          include_ai_disclaimer: job.include_ai_disclaimer ?? false,
          ai_opt_out_request_url: job.ai_opt_out_request_url ?? undefined,
        },
        rawJson: job as unknown as Record<string, unknown>,
      });
    });
}

// ============================================================================
// 2. ASHBY PUBLIC JOB POSTINGS API SCHEMA & NORMALIZER
// Endpoint: GET https://api.ashbyhq.com/posting-api/job-board/{JOB_BOARD_NAME}?includeCompensation=true
// ============================================================================

export const AshbyCompensationComponentSchema = z.object({
  compensationType: z.string(),
  interval: z.string().optional(),
  currencyCode: z.string().nullable().optional(),
  minValue: z.number().nullable().optional(),
  maxValue: z.number().nullable().optional(),
  summary: z.string().optional(),
});

export const AshbyJobPostingSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  location: z.string().optional(),
  secondaryLocations: z
    .array(
      z.object({
        location: z.string(),
      }),
    )
    .optional(),
  department: z.string().nullable().optional(),
  team: z.string().nullable().optional(),
  isListed: z.boolean().optional(),
  isRemote: z.boolean().nullable().optional(),
  workplaceType: z.enum(["OnSite", "Remote", "Hybrid"]).nullable().optional(),
  descriptionHtml: z.string().optional(),
  descriptionPlain: z.string().optional(),
  publishedAt: z.string().optional(),
  employmentType: z
    .enum(["FullTime", "PartTime", "Intern", "Contract", "Temporary"])
    .nullable()
    .optional(),
  jobUrl: z.string().url(),
  applyUrl: httpsUrl,
  compensation: z
    .object({
      compensationTierSummary: z.string().nullable().optional(),
      scrapeableCompensationSalarySummary: z.string().nullable().optional(),
      summaryComponents: z.array(AshbyCompensationComponentSchema).optional(),
    })
    .nullable()
    .optional(),
});

export const AshbyBoardResponseSchema = z.object({
  apiVersion: z.string().optional(),
  jobs: z.array(AshbyJobPostingSchema),
});

export function normalizeAshbyPayload(
  boardName: string,
  employerName: string,
  employerDomain: string | undefined,
  rawResponse: unknown,
): RawJobPayload[] {
  const parsed = AshbyBoardResponseSchema.parse(rawResponse);
  return parsed.jobs
    .filter((job) => job.isListed === true) // Mandatory per Ashby API documentation
    .map((job) => {
      const salaryComp = job.compensation?.summaryComponents?.find(
        (c) => c.compensationType === "Salary",
      );
      const interval = compensationInterval(salaryComp?.interval);
      const minVal = salaryComp?.minValue ?? undefined;
      const maxVal = salaryComp?.maxValue ?? undefined;
      const locations = [
        ...(job.location ? [job.location] : []),
        ...(job.secondaryLocations?.map((s) => s.location) ?? []),
      ];
      const wpMap: Record<string, RawJobPayload["rawWorkplaceType"]> = {
        Remote: "remote",
        Hybrid: "hybrid",
        OnSite: "onsite",
      };
      const empMap: Record<string, RawJobPayload["rawEmploymentType"]> = {
        FullTime: "full_time",
        PartTime: "part_time",
        Intern: "internship",
        Contract: "contract",
        Temporary: "temporary",
      };

      return RawJobPayloadSchema.parse({
        sourceProvider: "ashby",
        sourceTenantSlug: boardName,
        externalJobId: job.id ?? job.jobUrl,
        canonicalUrl: job.jobUrl,
        applyUrl: job.applyUrl,
        rawTitle: job.title,
        rawEmployerName: employerName,
        rawEmployerDomain: employerDomain,
        rawDescriptionHtml: job.descriptionHtml,
        rawDescriptionText:
          job.descriptionPlain ||
          stripHtml(job.descriptionHtml ?? "") ||
          job.title,
        rawLocations: locations,
        rawWorkplaceType:
          (job.workplaceType ? wpMap[job.workplaceType] : undefined) ??
          (job.isRemote ? "remote" : "unspecified"),
        rawEmploymentType:
          (job.employmentType ? empMap[job.employmentType] : undefined) ??
          "full_time",
        rawCompensation:
          minVal !== undefined || maxVal !== undefined
            ? {
                currency: salaryComp?.currencyCode ?? "USD",
                interval,
                minAmount: minVal,
                maxAmount: maxVal,
                minAnnualUsd:
                  salaryComp?.currencyCode === "USD"
                    ? annualizeCompensation(minVal, interval)
                    : undefined,
                maxAnnualUsd:
                  salaryComp?.currencyCode === "USD"
                    ? annualizeCompensation(maxVal, interval)
                    : undefined,
                rawText:
                  job.compensation?.scrapeableCompensationSalarySummary ??
                  undefined,
              }
            : undefined,
        publishedAt: job.publishedAt,
        rawJson: job as unknown as Record<string, unknown>,
      });
    });
}

// ============================================================================
// 3. LEVER POSTINGS API SCHEMA & NORMALIZER
// Endpoint: GET https://api.lever.co/v0/postings/{SITE}?mode=json
// ============================================================================

export const LeverPostingSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  hostedUrl: z.string().url(),
  applyUrl: httpsUrl,
  createdAt: z.number().int().optional(),
  workplaceType: z
    // Lever sends both "on-site" and "onsite" in live data (QA 2026-10-15).
    .enum(["unspecified", "on-site", "onsite", "remote", "hybrid"])
    .optional(),
  categories: z
    .object({
      location: z.string().optional(),
      allLocations: z.array(z.string()).optional(),
      commitment: z.string().optional(),
      team: z.string().optional(),
      department: z.string().optional(),
    })
    .optional(),
  description: z.string().optional(),
  descriptionPlain: z.string().optional(),
  lists: z
    .array(
      z.object({
        text: z.string(),
        content: z.string(),
      }),
    )
    .optional(),
  salaryRange: z
    .object({
      currency: z.string().optional(),
      interval: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .nullable()
    .optional(),
});

export const LeverPostingsResponseSchema = z.array(LeverPostingSchema);

export function normalizeLeverPayload(
  siteSlug: string,
  employerName: string,
  employerDomain: string | undefined,
  rawResponse: unknown,
): RawJobPayload[] {
  const parsed = LeverPostingsResponseSchema.parse(rawResponse);
  return parsed.map((job) => {
    const locations =
      job.categories?.allLocations && job.categories.allLocations.length > 0
        ? job.categories.allLocations
        : job.categories?.location
          ? [job.categories.location]
          : [];
    const wp: RawJobPayload["rawWorkplaceType"] =
      job.workplaceType === "on-site" || job.workplaceType === "onsite"
        ? "onsite"
        : job.workplaceType === "remote"
          ? "remote"
          : job.workplaceType === "hybrid"
            ? "hybrid"
            : "unspecified";

    const intervalRaw = (job.salaryRange?.interval ?? "year").toLowerCase();
    const interval: "year" | "month" | "week" | "day" | "hour" =
      intervalRaw.includes("hour")
        ? "hour"
        : intervalRaw.includes("month")
          ? "month"
          : intervalRaw.includes("week")
            ? "week"
            : intervalRaw.includes("day")
              ? "day"
              : "year";

    const listText = (job.lists ?? [])
      .map((l) => `${l.text}: ${stripHtml(l.content)}`)
      .join(" ");
    const fullPlain =
      `${job.descriptionPlain ?? stripHtml(job.description ?? "")} ${listText}`.trim();

    return RawJobPayloadSchema.parse({
      sourceProvider: "lever",
      sourceTenantSlug: siteSlug,
      externalJobId: job.id,
      canonicalUrl: job.hostedUrl,
      applyUrl: job.applyUrl,
      rawTitle: job.text,
      rawEmployerName: employerName,
      rawEmployerDomain: employerDomain,
      rawDescriptionHtml: job.description,
      rawDescriptionText: fullPlain || job.text,
      rawLocations: locations,
      rawWorkplaceType: wp,
      rawEmploymentType: /intern/i.test(job.categories?.commitment ?? "")
        ? "internship"
        : /contract/i.test(job.categories?.commitment ?? "")
          ? "contract"
          : "full_time",
      rawCompensation: job.salaryRange
        ? {
            currency: job.salaryRange.currency ?? "USD",
            interval,
            minAmount: job.salaryRange.min,
            maxAmount: job.salaryRange.max,
            minAnnualUsd:
              job.salaryRange.currency === "USD"
                ? annualizeCompensation(job.salaryRange.min, interval)
                : undefined,
            maxAnnualUsd:
              job.salaryRange.currency === "USD"
                ? annualizeCompensation(job.salaryRange.max, interval)
                : undefined,
          }
        : undefined,
      publishedAt: job.createdAt
        ? new Date(job.createdAt).toISOString()
        : undefined,
      rawJson: job as unknown as Record<string, unknown>,
    });
  });
}

// ============================================================================
// 4. USAJOBS OFFICIAL SEARCH API SCHEMA & NORMALIZER
// Endpoint: GET https://data.usajobs.gov/api/search
// ============================================================================

export const UsaJobsSearchItemSchema = z.object({
  MatchedObjectId: z.string().min(1),
  MatchedObjectDescriptor: z.object({
    PositionTitle: z.string().min(1),
    OrganizationName: z.string().min(1),
    PositionURI: z.string().url(),
    ApplyURI: z.array(z.string().url()).min(1),
    PositionLocationDisplay: z.string().optional(),
    PositionLocation: z
      .array(
        z.object({
          LocationName: z.string(),
        }),
      )
      .optional(),
    QualificationSummary: z.string().optional(),
    UserArea: z
      .object({
        Details: z
          .object({
            JobSummary: z.string().optional(),
            MajorDuties: z.array(z.string()).optional(),
            TeleworkEligible: z.boolean().optional(),
            RemoteIndicator: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
    PositionRemuneration: z
      .array(
        z.object({
          MinimumRange: z.string(),
          MaximumRange: z.string(),
          RateIntervalCode: z.string().optional(),
          Description: z.string().optional(),
        }),
      )
      .optional(),
    PublicationStartDate: z.string().optional(),
    ApplicationCloseDate: z.string().optional(),
  }),
});

export const UsaJobsResponseSchema = z.object({
  SearchResult: z.object({
    SearchResultItems: z.array(UsaJobsSearchItemSchema),
  }),
});

export function normalizeUsaJobsPayload(rawResponse: unknown): RawJobPayload[] {
  const parsed = UsaJobsResponseSchema.parse(rawResponse);
  return parsed.SearchResult.SearchResultItems.map((item) => {
    const desc = item.MatchedObjectDescriptor;
    const rem = desc.PositionRemuneration?.[0];
    const isHourly =
      rem?.RateIntervalCode === "PH" || /hour/i.test(rem?.Description ?? "");
    const interval: "year" | "hour" = isHourly ? "hour" : "year";
    const minRaw = rem ? Number.parseFloat(rem.MinimumRange) : undefined;
    const maxRaw = rem ? Number.parseFloat(rem.MaximumRange) : undefined;
    const summaryText = [
      desc.UserArea?.Details?.JobSummary ?? "",
      ...(desc.UserArea?.Details?.MajorDuties ?? []),
      desc.QualificationSummary ?? "",
    ]
      .join(" ")
      .trim();

    return RawJobPayloadSchema.parse({
      sourceProvider: "usajobs",
      externalJobId: item.MatchedObjectId,
      canonicalUrl: desc.PositionURI,
      applyUrl: desc.ApplyURI[0] ?? desc.PositionURI,
      rawTitle: desc.PositionTitle,
      rawEmployerName: desc.OrganizationName,
      rawDescriptionText: summaryText || desc.PositionTitle,
      rawLocations:
        desc.PositionLocation?.map((l) => l.LocationName) ??
        (desc.PositionLocationDisplay ? [desc.PositionLocationDisplay] : []),
      // Remote only on an explicit signal; telework eligibility alone is not "remote".
      rawWorkplaceType:
        desc.UserArea?.Details?.RemoteIndicator === true ||
        /\bremote\b/i.test(desc.PositionLocationDisplay ?? "")
          ? "remote"
          : "unspecified",
      rawEmploymentType: "full_time",
      rawCompensation:
        minRaw !== undefined && !Number.isNaN(minRaw)
          ? {
              currency: "USD",
              interval,
              minAmount: minRaw,
              maxAmount: maxRaw,
              minAnnualUsd: annualizeCompensation(minRaw, interval),
              maxAnnualUsd: annualizeCompensation(maxRaw, interval),
            }
          : undefined,
      publishedAt: desc.PublicationStartDate,
      validThrough: desc.ApplicationCloseDate,
      rawJson: item as unknown as Record<string, unknown>,
    });
  });
}

// ============================================================================
// 5. TIER-1 FIXTURE BUNDLE, ATS SEED REGISTRY & USAJOBS HEADER NAMES
// (ported from Gemini Packet #1; builds on the schemas above, no normalizer changes)
// ============================================================================

// Header NAMES only; values come from env at runtime and are never stored here.
export const USAJOBS_REQUIRED_HEADER_NAMES = ["Authorization-Key", "User-Agent"] as const;

export const Tier1FixturesBundleSchema = z
  .object({
    greenhouse: GreenhouseBoardResponseSchema,
    ashby: AshbyBoardResponseSchema,
    lever: LeverPostingsResponseSchema,
    usajobs: UsaJobsResponseSchema,
  })
  .strict();

export type Tier1FixturesBundle = z.infer<typeof Tier1FixturesBundleSchema>;

// Seed registry: free, public GET boards only (D8: no paid aggregators, no LinkedIn/Indeed/ZipRecruiter).
export const AtsSeedRegistryEntrySchema = z
  .object({
    canonicalName: z.string().min(1),
    domain: z
      .string()
      .min(1)
      .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "bare lowercase domain required"),
    provider: z.enum(["greenhouse", "ashby", "lever"]),
    boardToken: z.string().regex(/^[a-z0-9-]+$/, "lowercase board token required"),
  })
  .strict();

export type AtsSeedRegistryEntry = z.infer<typeof AtsSeedRegistryEntrySchema>;

export const AtsSeedRegistrySchema = z
  .object({
    version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    employers: z.array(AtsSeedRegistryEntrySchema).min(5),
  })
  .strict()
  .superRefine((registry, ctx) => {
    const seen = new Set<string>();
    for (const e of registry.employers) {
      const key = `${e.provider}:${e.boardToken}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate board ${key}` });
      }
      seen.add(key);
    }
  });
