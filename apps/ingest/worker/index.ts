// Cloudflare Worker stub (NOT deployed). Cron: pull boards in batches -> (later) Supabase upsert.
// wrangler.toml: [triggers] crons = ["0 11,17,23 * * *"]
import { fetchBoard } from "../src/adapters.js";
import type { Board } from "../src/types.js";
export interface Env { SEED_BOARDS_JSON: string; SUPABASE_URL?: string; SUPABASE_SERVICE_KEY?: string; }
export default {
  async scheduled(_c: unknown, env: Env) {
    const boards: Board[] = JSON.parse(env.SEED_BOARDS_JSON).filter((b: any) => b.enabled !== false);
    // Workers cap subrequests per invocation; shard by hour so each run hits ≤40 boards.
    const shard = new Date().getUTCHours() % Math.ceil(boards.length / 40);
    const batch = boards.slice(shard * 40, shard * 40 + 40);
    const res = await Promise.allSettled(batch.map(fetchBoard));
    const jobs = res.flatMap(r => r.status === "fulfilled" ? r.value : []);
    console.log(JSON.stringify({ shard, boards: batch.length, ok: res.filter(r => r.status === "fulfilled").length, jobs: jobs.length }));
    // TODO(M2): upsert into Supabase `jobs` on conflict (id); mark unseen ids closed after 2 consecutive misses.
  },
};
