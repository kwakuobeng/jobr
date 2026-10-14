// Add display names (Greenhouse board API exposes name) and flag same-company multi-ATS duplicates.
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { BoardsSchema } from "./types.js";
import { getJson } from "./adapters.js";
const p = new URL("../../../data/seed-boards.json", import.meta.url);
const seed = BoardsSchema.parse(JSON.parse(readFileSync(p, "utf8")));
await Promise.all(
  seed
    .filter((b) => b.ats === "greenhouse")
    .map(async (b) => {
      try {
        b.company =
          z
            .object({ name: z.string().optional() })
            .parse(
              await getJson(
                `https://boards-api.greenhouse.io/v1/boards/${b.token}`,
                1,
              ),
            ).name ?? b.company;
      } catch (error) {
        console.warn(`Board enrichment failed: ${b.token}: ${String(error)}`);
      }
    }),
);
const byTok: Record<string, typeof seed> = {};
for (const b of seed) (byTok[b.token.toLowerCase()] ??= []).push(b);
for (const g of Object.values(byTok))
  if (g.length > 1) {
    g.sort((a, b) => (b.jobsAtVerify ?? 0) - (a.jobsAtVerify ?? 0));
    g.slice(1).forEach((b) => {
      b.enabled = false;
      b.note = `slug also on ${g[0]?.ats}; disabled (likely stale/duplicate board)`;
    });
  }
for (const b of seed) b.enabled ??= true;
writeFileSync(p, JSON.stringify(seed, null, 2));
console.log("enabled", seed.filter((b) => b.enabled).length, "of", seed.length);
