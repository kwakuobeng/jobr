// Cloudflare Worker stub (NOT deployed). Cron: pull boards in batches -> (later) Supabase upsert.
// wrangler.toml: [triggers] crons = ["0 11,17,23 * * *"]
import { fetchBoard } from "../src/adapters.js";
import { BoardsSchema } from "../src/types.js";
import { logFailure } from "../src/config.js";
export interface Env { SEED_BOARDS_JSON: string; SUPABASE_URL?: string; SUPABASE_SERVICE_KEY?: string; }
const worker = {
  async scheduled(_c: unknown, env: Env) {
    const boards = BoardsSchema.parse(JSON.parse(env.SEED_BOARDS_JSON)).filter(b => b.enabled !== false);
    // Workers cap subrequests per invocation; shard by hour so each run hits ≤40 boards.
    const shard = new Date().getUTCHours() % Math.max(1, Math.ceil(boards.length / 40));
    const batch = boards.slice(shard * 40, shard * 40 + 40);
    const res = await Promise.allSettled(batch.map(b => fetchBoard(b)));
    res.forEach((r, i) => { const b = batch[i]; if (r.status === "rejected" && b) logFailure(b.ats, b.token, r.reason); });
    const jobs = res.flatMap(r => r.status === "fulfilled" ? r.value : []);
    console.log(JSON.stringify({ shard, boards: batch.length, ok: res.filter(r => r.status === "fulfilled").length, failures: res.filter(r => r.status === "rejected").length, jobs: jobs.length }));
    // TODO(M2): upsert into Supabase `jobs` on conflict (id); mark unseen ids closed after 2 consecutive misses.
  },
};

export default worker;
