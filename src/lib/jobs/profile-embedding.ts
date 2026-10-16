import { bindingEmbedder, EMBEDDING_MODEL, profileEmbeddingText, sha256Hex, toVectorLiteral, type AiBinding } from "../embeddings";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchingChips } from "./model";

/** Minimal session (RLS-scoped) client surface used here. */
export type ProfileClient = Pick<SupabaseClient, "from">;
/** Workers AI binding from the OpenNext Cloudflare context; null outside Workers (tests, next dev). */
export async function aiBinding(): Promise<AiBinding | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as unknown as { AI?: AiBinding };
    return env.AI ?? null;
  } catch { return null; }
}
/**
 * Keep candidate_profiles.target_job_embedding in step with the confirmed resume chips. Recomputed
 * only when the chip text changes (hash). Never blocks matching: any failure leaves the old value.
 */
export async function ensureProfileEmbedding(client: ProfileClient, userId: string, profileId: string, chips: MatchingChips | null, ai: AiBinding | null): Promise<"current" | "updated" | "skipped"> {
  const text = profileEmbeddingText(chips);
  if (!text || !ai) return "skipped";
  try {
    const hash = await sha256Hex(`${EMBEDDING_MODEL}\n${text}`);
    const current = await client.from("candidate_profiles").select("target_embedding_source_hash").eq("id", profileId).eq("user_id", userId).maybeSingle();
    if (current.error) return "skipped";
    if (z.object({ target_embedding_source_hash: z.string().nullable().optional() }).nullable().parse(current.data)?.target_embedding_source_hash === hash) return "current";
    const [vector] = await bindingEmbedder(ai)([text]);
    if (!vector) return "skipped";
    const saved = await client.from("candidate_profiles").update({ target_job_embedding: toVectorLiteral(vector), target_embedding_model: EMBEDDING_MODEL, target_embedding_source_hash: hash })
      .eq("id", profileId).eq("user_id", userId);
    return saved.error ? "skipped" : "updated";
  } catch { return "skipped"; }
}
