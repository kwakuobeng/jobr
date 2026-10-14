import { normalizeLeverPayload } from "../../../../specs/ingestion/zod_provider_schemas";
import { PublicBoardAdapter } from "./public-board";
import type { HttpClient } from "../ssrf-client";
export class LeverAdapter extends PublicBoardAdapter {
  constructor(client?: HttpClient) {
    super(
      "lever",
      "api.lever.co",
      (tenant) => `https://api.lever.co/v0/postings/${tenant}?mode=json`,
      normalizeLeverPayload,
      client,
    );
  }
}
