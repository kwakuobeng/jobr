import { z } from "zod";
import { normalizeUsaJobsPayload } from "../../../../specs/ingestion/zod_provider_schemas";
import { createSafeClient, type HttpClient } from "../ssrf-client";
import { TokenBucket } from "../rate-limiter";
import type { JobSourceAdapter, SyncWatermark } from "../types";
import { SourceHttpError } from "./public-board";
const Config = z.object({
  apiKey: z.string().min(1),
  userAgent: z.string().email(),
  keyword: z.string().default(""),
  page: z.number().int().min(1).default(1),
});
export class UsaJobsAdapter implements JobSourceAdapter {
  readonly providerName = "usajobs" as const;
  private bucket = new TokenBucket();
  constructor(
    private client: HttpClient = createSafeClient(["data.usajobs.gov"]),
  ) {}
  async fetchIncremental(
    watermark: SyncWatermark | null,
    config: Record<string, unknown>,
  ) {
    const c = Config.parse(config);
    this.bucket.take();
    const url = new URL("https://data.usajobs.gov/api/search");
    const page = watermark?.cursor ? Number(watermark.cursor) : c.page;
    if (!Number.isSafeInteger(page) || page < 1)
      throw new Error("Invalid cursor");
    url.searchParams.set("Keyword", c.keyword);
    url.searchParams.set("Page", String(page));
    const result = await this.client(url.href, {
      "Authorization-Key": c.apiKey,
      "User-Agent": c.userAgent,
      Host: "data.usajobs.gov",
    });
    if (result.status !== 200) throw new SourceHttpError(result.status);
    const raw: unknown = JSON.parse(result.text);
    const jobs = normalizeUsaJobsPayload(raw);
    // Explicit pagination cursor. Caller stops on an empty page; never interprets a partial page as a full-board snapshot.
    return {
      jobs,
      nextWatermark: {
        lastSyncedAt: new Date().toISOString(),
        ...(jobs.length ? { cursor: String(page + 1) } : {}),
      },
    };
  }
  async verifyListingActive(
    externalJobId: string,
    _canonicalUrl: string,
    config: Record<string, unknown> = {},
  ) {
    const c = Config.parse(config);
    this.bucket.take();
    const url = new URL("https://data.usajobs.gov/api/search");
    url.searchParams.set("ControlNumber", externalJobId);
    const result = await this.client(url.href, {
      "Authorization-Key": c.apiKey,
      "User-Agent": c.userAgent,
      Host: "data.usajobs.gov",
    });
    if (result.status !== 200) throw new SourceHttpError(result.status);
    const jobs = normalizeUsaJobsPayload(JSON.parse(result.text));
    const isActive = jobs.some((j) => j.externalJobId === externalJobId);
    return {
      isActive,
      httpStatus: 200,
      ...(!isActive ? { closedReason: "ats_unlisted" as const } : {}),
    };
  }
}
