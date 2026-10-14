// Cloudflare scheduled board probe (not deployed). Reports validated public-board counts.
// wrangler.toml: [triggers] crons = ["0 11,17,23 * * *"]
import { fetchBoard } from "../src/adapters.js";
import { BoardsSchema } from "../src/types.js";
export interface Env {
  SEED_BOARDS_JSON: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
}
const worker = {
  async scheduled(_c: unknown, env: Env) {
    const boards = BoardsSchema.parse(JSON.parse(env.SEED_BOARDS_JSON)).filter(
      (b) => b.enabled !== false,
    );
    // Workers cap subrequests per invocation; shard by hour so each run hits ≤40 boards.
    const shard = new Date().getUTCHours() % Math.ceil(boards.length / 40);
    const batch = boards.slice(shard * 40, shard * 40 + 40);
    const res = await Promise.allSettled(
      batch.map((board) => fetchBoard(board)),
    );
    const jobs = res.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    console.log(
      JSON.stringify({
        shard,
        boards: batch.length,
        ok: res.filter((r) => r.status === "fulfilled").length,
        jobs: jobs.length,
      }),
    );
    return { shard, boards: batch.length, jobs: jobs.length };
  },
};

export default worker;
