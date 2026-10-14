import { normalizeAshbyPayload } from "../../../../specs/ingestion/zod_provider_schemas";
import { PublicBoardAdapter } from "./public-board";
import type { HttpClient } from "../ssrf-client";
export class AshbyAdapter extends PublicBoardAdapter {
  constructor(client?: HttpClient) {
    super(
      "ashby",
      "api.ashbyhq.com",
      (tenant) =>
        `https://api.ashbyhq.com/posting-api/job-board/${tenant}?includeCompensation=true`,
      normalizeAshbyPayload,
      client,
    );
  }
}
