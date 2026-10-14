import type { RawJobPayload } from "../../../specs/ingestion/zod_provider_schemas";
export type { RawJobPayload };
export interface Tenant {
  slug: string;
  employerName: string;
  employerDomain?: string;
}
export interface JobSourceAdapter {
  fetchJobs(tenant: Tenant): Promise<RawJobPayload[]>;
}

import {
  fetchRawBoard,
  type AdapterOptions,
} from "../../../apps/ingest/src/adapters";
import type { AtsType } from "../../../apps/ingest/src/types";
import type { HttpClient } from "./ssrf-client";
export function canonicalFetchJobs(
  provider: AtsType,
  tenant: Tenant,
  client?: HttpClient,
): Promise<RawJobPayload[]> {
  const options: AdapterOptions = client
    ? {
        http: async (url, options) => ({
          ...(await client(url, options?.headers)),
          url,
        }),
      }
    : {};
  return fetchRawBoard(
    {
      ats: provider,
      token: tenant.slug,
      company: tenant.employerName,
      source: "Jobr configured tenant",
    },
    options,
  ).then((jobs) =>
    jobs.map((job) => ({ ...job, rawEmployerDomain: tenant.employerDomain })),
  );
}
