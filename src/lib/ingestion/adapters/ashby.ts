import { canonicalFetchJobs, type Tenant } from "../adapter";
import { normalizeAshbyPayload } from "../../../../specs/ingestion/zod_provider_schemas";
import { PublicBoardAdapter } from "./public-board";
import type { HttpClient } from "../ssrf-client";
export class AshbyAdapter extends PublicBoardAdapter {
  constructor(private readonly packetClient?: HttpClient) {
    super(
      "ashby",
      "api.ashbyhq.com",
      (tenant) =>
        `https://api.ashbyhq.com/posting-api/job-board/${tenant}?includeCompensation=true`,
      normalizeAshbyPayload,
      packetClient,
    );
  }
  fetchJobs(tenant: Tenant) {
    return canonicalFetchJobs("ashby", tenant, this.packetClient);
  }
}
