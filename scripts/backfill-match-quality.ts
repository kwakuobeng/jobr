/**
 * One-off backfill after migration 0009 (run by Kwaku; never run automatically):
 *   1. canonical_jobs.region / country_codes from src/lib/jobs/region.ts
 *   2. merge per-office duplicate postings (merge_duplicate_postings RPC)
 *   3. 768-dim job embeddings via Workers AI REST (@cf/baai/bge-base-en-v1.5)
 * Profiles embed themselves on the next Matches load (Workers AI binding on the jobr worker).
 *
 * Dry run (default) only reads and reports. Write with --apply.
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… \
 *   pnpm exec tsx scripts/backfill-match-quality.ts [--apply] [--skip-embeddings]
 */
import { createClient } from "@supabase/supabase-js";
import { locationTextParts } from "../src/lib/jobs/workplace-badge";
import { classifyLocations } from "../src/lib/jobs/region";
import { restEmbedder } from "../src/lib/embeddings";
import { embedPendingJobs, type Db } from "../src/lib/ingestion/pipeline";

const apply = process.argv.includes("--apply");
const skipEmbeddings = process.argv.includes("--skip-embeddings");
const need = (name: string) => { const v = process.env[name]; if (!v) throw new Error(`${name} is required`); return v; };

async function main() {
  const db = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const jobs: Array<{ id: string; locations_json: unknown; region: string | null; country_codes: string[] | null }> = [];
  for (let from = 0; ; from += 1000) {
    const page = await db.from("canonical_jobs").select("id,locations_json,region,country_codes").order("id").range(from, from + 999);
    if (page.error) throw new Error(page.error.message);
    jobs.push(...page.data); if (page.data.length < 1000) break;
  }
  const changes = jobs.map((j) => ({ id: j.id, ...classifyLocations(locationTextParts(j.locations_json)) }))
    .filter((c, i) => c.region !== jobs[i]!.region || c.country_codes.join() !== (jobs[i]!.country_codes ?? []).join());
  const tally = changes.reduce<Record<string, number>>((t, c) => ({ ...t, [c.region]: (t[c.region] ?? 0) + 1 }), {});
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", jobs: jobs.length, regionUpdates: changes.length, byRegion: tally }));
  if (!apply) { console.log("Dry run: nothing written. Re-run with --apply."); return; }
  for (const c of changes) {
    const r = await db.from("canonical_jobs").update({ region: c.region, country_codes: c.country_codes }).eq("id", c.id);
    if (r.error) throw new Error(r.error.message);
  }
  const merged = await db.rpc("merge_duplicate_postings");
  if (merged.error) throw new Error(merged.error.message);
  console.log(JSON.stringify({ merged: merged.data }));
  if (skipEmbeddings) return;
  const embed = restEmbedder(need("CLOUDFLARE_ACCOUNT_ID"), need("CLOUDFLARE_API_TOKEN"));
  let total = 0;
  for (;;) { const n = await embedPendingJobs(db as unknown as Db, embed, 100); total += n; console.log(JSON.stringify({ embedded: total })); if (n < 100) break; }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
