// Jobr ingest worker (D6): Cron (hourly) → Queue (one message per source) → consumer.
// Code only: NOT deployed by this PR. See apps/ingest/wrangler.jsonc and apps/ingest/README.md.
import { createClient } from "@supabase/supabase-js";
import boardsJson from "../../../data/job-boards.json";
import { bindingEmbedder, type AiBinding } from "../../../src/lib/embeddings";
import {
  BoardSchema, QueueMessageSchema, SourceSchema, embedPendingJobs, runSource, syncBoards, type Db,
} from "../../../src/lib/ingestion/pipeline";
import { z } from "zod";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string; // wrangler secret
  USAJOBS_API_KEY?: string; // wrangler secret (optional)
  USAJOBS_USER_AGENT_EMAIL?: string;
  AI: AiBinding;
  INGEST_QUEUE: { sendBatch(messages: { body: unknown }[]): Promise<void> };
}
interface Message { body: unknown; ack(): void; retry(): void }

const db = (env: Env) => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) as unknown as Db;
const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ event, ...data }));

export async function scheduled(env: Env): Promise<number> {
  const client = db(env);
  const boards = z.array(BoardSchema).parse(boardsJson);
  if (env.USAJOBS_API_KEY && env.USAJOBS_USER_AGENT_EMAIL) {
    const usa = await client.from("job_sources").upsert(
      [{ provider_type: "usajobs", tenant_slug: "usajobs-search", display_name: "USAJOBS", base_endpoint_url: "https://data.usajobs.gov/api/search", is_active: true, poll_interval_minutes: 60 }],
      { onConflict: "provider_type,tenant_slug" });
    if (usa.error) log("usajobs_source_error", { message: usa.error.message });
  }
  const sources = await syncBoards(client, boards);
  for (let i = 0; i < sources.length; i += 100)
    await env.INGEST_QUEUE.sendBatch(sources.slice(i, i + 100).map((s) => ({ body: { sourceId: s.id } })));
  // Housekeeping once per hour: merge any office copies that slipped through, close long-unlisted jobs.
  const merged = await client.rpc("merge_duplicate_postings");
  const closed = await client.rpc("close_stale_jobs", { p_stale_hours: 48 });
  log("cron", { sources: sources.length, merged: merged.data, closed: closed.data, errors: [merged.error?.message, closed.error?.message].filter(Boolean) });
  return sources.length;
}

export async function consume(messages: readonly Message[], env: Env): Promise<void> {
  const client = db(env);
  for (const message of messages) {
    try {
      const { sourceId } = QueueMessageSchema.parse(message.body);
      const found = await client.from("job_sources").select("id,provider_type,tenant_slug,display_name").eq("id", sourceId).eq("is_active", true).maybeSingle();
      if (found.error) throw new Error(found.error.message);
      if (!found.data) { message.ack(); continue; }
      const source = SourceSchema.parse(found.data);
      const result = await runSource(client, source, {
        ...(env.USAJOBS_API_KEY && env.USAJOBS_USER_AGENT_EMAIL ? { usajobs: { apiKey: env.USAJOBS_API_KEY, userAgent: env.USAJOBS_USER_AGENT_EMAIL } } : {}),
      });
      log("source_ok", { ...result });
      message.ack();
    } catch (error) {
      log("source_failed", { message: error instanceof Error ? error.message : String(error) });
      message.retry();
    }
  }
  // Embed new/changed jobs with Workers AI after each batch (bounded; free tier).
  try { log("embedded", { jobs: await embedPendingJobs(client, bindingEmbedder(env.AI), 100) }); }
  catch (error) { log("embed_failed", { message: error instanceof Error ? error.message : String(error) }); }
}

const worker = {
  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) { ctx.waitUntil(scheduled(env)); },
  async queue(batch: { messages: readonly Message[] }, env: Env) { await consume(batch.messages, env); },
};
export default worker;
