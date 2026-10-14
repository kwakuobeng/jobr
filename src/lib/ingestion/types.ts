export {
  RawJobPayloadSchema,
  type RawJobPayload,
} from "../../../specs/ingestion/zod_provider_schemas";
import type { RawJobPayload } from "../../../specs/ingestion/zod_provider_schemas";
export interface SyncWatermark {
  lastSyncedAt: string;
  etag?: string;
  cursor?: string;
}
export interface ActiveResult {
  isActive: boolean;
  httpStatus: number;
  closedReason?:
    | "http_404"
    | "http_410"
    | "ats_unlisted"
    | "expired_valid_through"
    | "redirect_to_index";
}
export interface JobSourceAdapter {
  readonly providerName: RawJobPayload["sourceProvider"];
  fetchIncremental(
    watermark: SyncWatermark | null,
    config: Record<string, unknown>,
  ): Promise<{
    jobs: RawJobPayload[];
    nextWatermark: SyncWatermark;
    closedExternalIds?: string[];
  }>;
  verifyListingActive(
    externalJobId: string,
    canonicalUrl: string,
    config?: Record<string, unknown>,
  ): Promise<ActiveResult>;
}
