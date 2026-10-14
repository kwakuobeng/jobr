// Add display names (Greenhouse board API exposes name) and flag same-company multi-ATS duplicates.
import { readFileSync, writeFileSync } from "node:fs";
import { getJson } from "./adapters.js";
const p = new URL("../../../data/seed-boards.json", import.meta.url);
const seed = JSON.parse(readFileSync(p, "utf8"));
await Promise.all(seed.filter((b: any) => b.ats === "greenhouse").map(async (b: any) => { try { b.company = (await getJson(`https://boards-api.greenhouse.io/v1/boards/${b.token}`, 1)).name ?? b.company; } catch {} }));
const byTok: Record<string, any[]> = {}; for (const b of seed) (byTok[b.token.toLowerCase()] ??= []).push(b);
for (const g of Object.values(byTok)) if (g.length > 1) { g.sort((a, b) => b.jobsAtVerify - a.jobsAtVerify); g.slice(1).forEach(b => { b.enabled = false; b.note = `slug also on ${g[0].ats}; disabled (likely stale/duplicate board)`; }); }
for (const b of seed) b.enabled ??= true;
writeFileSync(p, JSON.stringify(seed, null, 2));
console.log("enabled", seed.filter((b: any) => b.enabled).length, "of", seed.length);
