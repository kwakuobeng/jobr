import { canonicalFetchJobs, type Tenant } from "../adapter";
import { normalizeGreenhousePayload } from "../../../../specs/ingestion/zod_provider_schemas";
import { PublicBoardAdapter } from "./public-board";
import type { HttpClient } from "../ssrf-client";
export class GreenhouseAdapter extends PublicBoardAdapter {
  constructor(private readonly packetClient?: HttpClient) {
    super(
      "greenhouse",
      "boards-api.greenhouse.io",
      (tenant) =>
        `https://boards-api.greenhouse.io/v1/boards/${tenant}/jobs?content=true`,
      normalizeGreenhousePayload,
      packetClient,
    );
  }
  fetchJobs(tenant: Tenant) {
    return canonicalFetchJobs("greenhouse", tenant, this.packetClient);
  }
}
