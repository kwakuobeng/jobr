import { z } from "zod";
import { createSafeClient, type HttpClient } from "../ssrf-client";
import { TokenBucket } from "../rate-limiter";
import type { JobSourceAdapter, RawJobPayload, SyncWatermark } from "../types";
const Config = z.object({
  tenant: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  employerName: z.string().min(1),
  employerDomain: z.string().optional(),
});
export class SourceHttpError extends Error {
  constructor(public status: number) {
    super(`Source returned HTTP ${status}`);
  }
}
export class PublicBoardAdapter implements JobSourceAdapter {
  private bucket = new TokenBucket();
  private client: HttpClient;
  constructor(
    readonly providerName: RawJobPayload["sourceProvider"],
    private host: string,
    private endpoint: (tenant: string) => string,
    private normalize: (
      tenant: string,
      employer: string,
      domain: string | undefined,
      payload: unknown,
    ) => RawJobPayload[],
    client?: HttpClient,
  ) {
    this.client = client ?? createSafeClient([host]);
  }
  async fetchIncremental(
    watermark: SyncWatermark | null,
    config: Record<string, unknown>,
  ) {
    const c = Config.parse(config);
    this.bucket.take();
    const result = await this.client(
      this.endpoint(c.tenant),
      watermark?.etag ? { "If-None-Match": watermark.etag } : {},
    );
    if (result.status === 304) {
      if (!watermark) throw new SourceHttpError(304);
      return {
        jobs: [],
        nextWatermark: { ...watermark, lastSyncedAt: new Date().toISOString() },
      };
    }
    if (result.status !== 200) throw new SourceHttpError(result.status);
    const jobs = this.normalize(
      c.tenant,
      c.employerName,
      c.employerDomain,
      JSON.parse(result.text),
    );
    const etag = result.headers.etag;
    return {
      jobs,
      nextWatermark: {
        lastSyncedAt: new Date().toISOString(),
        ...(typeof etag === "string" ? { etag } : {}),
      },
    };
  }
  async verifyListingActive(
    externalJobId: string,
    _canonicalUrl: string,
    config: Record<string, unknown> = {},
  ) {
    // Full board membership is authoritative; never fetch a supplied canonical URL here.
    const { jobs } = await this.fetchIncremental(null, config);
    const isActive = jobs.some((job) => job.externalJobId === externalJobId);
    return {
      isActive,
      httpStatus: 200,
      ...(!isActive ? { closedReason: "ats_unlisted" as const } : {}),
    };
  }
}
