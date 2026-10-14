import { canonicalFetchJobs, type Tenant } from "../adapter";
import { normalizeLeverPayload } from "../../../../specs/ingestion/zod_provider_schemas";
import { PublicBoardAdapter } from "./public-board";
import type { HttpClient } from "../ssrf-client";
export class LeverAdapter extends PublicBoardAdapter {
  constructor(private readonly packetClient?: HttpClient) {
    super(
      "lever",
      "api.lever.co",
      (tenant) => `https://api.lever.co/v0/postings/${tenant}?mode=json`,
      normalizeLeverPayload,
      packetClient,
    );
  }
  fetchJobs(tenant: Tenant) {
    return canonicalFetchJobs("lever", tenant, this.packetClient);
  }
}
