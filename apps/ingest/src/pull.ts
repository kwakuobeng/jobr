// Pull all enabled boards -> data/jobs-<date>.jsonl + data/jobs-latest.json + data/pull-report.json
import { readFileSync, writeFileSync } from "node:fs";
import { fetchBoard } from "./adapters.js";
import { BoardsSchema, type JobListing } from "./types.js";
const D = new URL("../../../data/", import.meta.url);
const boards = BoardsSchema.parse(
  JSON.parse(readFileSync(new URL("seed-boards.json", D), "utf8")),
).filter((b) => b.enabled !== false);
const conc = Number(process.env.CONCURRENCY ?? 8);
const results: {
  ats: string;
  token: string;
  ok: boolean;
  jobs: number;
  ms: number;
  error?: string;
}[] = [];
const jobs = new Map<string, JobListing>();
const seenHash = new Set<string>();
let crossDupes = 0;
let i = 0;
async function worker() {
  while (i < boards.length) {
    const b = boards[i++];
    if (!b) break;
    const t = Date.now();
    try {
      const js = await fetchBoard(b);
      for (const j of js) {
        if (jobs.has(j.id)) continue;
        if (seenHash.has(j.dedupeHash)) {
          crossDupes++;
          continue;
        }
        seenHash.add(j.dedupeHash);
        jobs.set(j.id, j);
      }
      results.push({
        ats: b.ats,
        token: b.token,
        ok: true,
        jobs: js.length,
        ms: Date.now() - t,
      });
    } catch (e: unknown) {
      results.push({
        ats: b.ats,
        token: b.token,
        ok: false,
        jobs: 0,
        ms: Date.now() - t,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
const start = Date.now();
await Promise.all(Array.from({ length: conc }, worker));
const all = [...jobs.values()];
const day = new Date().toISOString().slice(0, 10);
writeFileSync(
  new URL(`jobs-${day}.jsonl`, D),
  all.map((j) => JSON.stringify(j)).join("\n") + "\n",
);
writeFileSync(new URL("jobs-latest.json", D), JSON.stringify(all));
const ok = results.filter((r) => r.ok).length;
const byAts = Object.fromEntries(
  ["greenhouse", "lever", "ashby", "smartrecruiters"].map((a) => {
    const r = results.filter((x) => x.ats === a);
    return [
      a,
      {
        boards: r.length,
        ok: r.filter((x) => x.ok).length,
        jobs: r.reduce((s, x) => s + x.jobs, 0),
      },
    ];
  }),
);
const report = {
  ranAt: new Date().toISOString(),
  boards: boards.length,
  ok,
  successRate: +((100 * ok) / boards.length).toFixed(1),
  uniqueJobs: all.length,
  crossBoardDupesDropped: crossDupes,
  elapsedSec: (Date.now() - start) / 1000,
  byAts,
  failures: results.filter((r) => !r.ok),
};
writeFileSync(
  new URL("pull-report.json", D),
  JSON.stringify({ ...report, results }, null, 2),
);
console.log(JSON.stringify(report, null, 2));
