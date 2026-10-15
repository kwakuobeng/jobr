// Add display names (Greenhouse board API exposes name) and flag same-company multi-ATS duplicates.
import { readFileSync, writeFileSync } from "node:fs";
import { getJson } from "./adapters.js";
import { z } from "zod";
import { BoardsSchema, type Board } from "./types.js";
import { seedPath, logFailure } from "./config.js";
const p = seedPath;
let failures = 0;
const seed = BoardsSchema.parse(JSON.parse(readFileSync(p, "utf8")));
await Promise.all(seed.filter((b) => b.ats === "greenhouse").map(async (b) => { try { b.company = z.object({ name: z.string().optional() }).parse(await getJson(`https://boards-api.greenhouse.io/v1/boards/${b.token}`, 1)).name ?? b.company; } catch (error: unknown) { failures++; logFailure(b.ats, b.token, error); } }));
const byTok: Record<string, Board[]> = {}; for (const b of seed) (byTok[b.token.toLowerCase()] ??= []).push(b);
for (const g of Object.values(byTok)) if (g.length > 1) { g.sort((a, b) => (b.jobsAtVerify ?? 0) - (a.jobsAtVerify ?? 0)); g.slice(1).forEach(b => { b.enabled = false; b.note = `slug also on ${g[0]?.ats}; disabled (likely stale/duplicate board)`; }); }
for (const b of seed) b.enabled ??= true;
writeFileSync(p, JSON.stringify(seed, null, 2));
console.log("enabled", seed.filter((b) => b.enabled).length, "of", seed.length);

console.log(JSON.stringify({ event: "enrich_summary", boards: seed.length, failures }));
