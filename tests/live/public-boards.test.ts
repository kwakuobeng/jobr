import { describe, it, expect } from "vitest";
import { GreenhouseAdapter } from "@/lib/ingestion/adapters/greenhouse";
import { AshbyAdapter } from "@/lib/ingestion/adapters/ashby";
import { RawJobPayloadSchema } from "../../specs/ingestion/zod_provider_schemas";
const boards = [
  { provider: "greenhouse", tenant: "figma", employerName: "Figma" },
  { provider: "greenhouse", tenant: "cloudflare", employerName: "Cloudflare" },
  { provider: "greenhouse", tenant: "vercel", employerName: "Vercel" },
  { provider: "ashby", tenant: "linear", employerName: "Linear" },
  { provider: "ashby", tenant: "supabase", employerName: "Supabase" },
];
describe.skipIf(process.env.JOBR_LIVE !== "1")(
  "live public-board proof of work",
  () => {
    it.each(boards)(
      "$provider / $tenant",
      async (board) => {
        const adapter =
          board.provider === "greenhouse"
            ? new GreenhouseAdapter()
            : new AshbyAdapter();
        const result = await adapter.fetchIncremental(null, board);
        expect(result.jobs.length).toBeGreaterThan(0);
        result.jobs.forEach((job) => RawJobPayloadSchema.parse(job));
        console.info(
          `${board.provider}/${board.tenant}: ${result.jobs.length} validated jobs`,
        );
      },
      20_000,
    );
  },
);
