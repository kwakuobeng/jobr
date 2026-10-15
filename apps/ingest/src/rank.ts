import { z } from "zod";
import type { JobListing } from "./types.js";
const regex = z.string().min(1).refine(value => { try { new RegExp(value); return true; } catch { return false; } }, "Invalid regular expression");
export const RankingProfileSchema = z.object({
  titleInclude: regex, titleExclude: regex, locationPattern: regex,
  allowRemote: z.boolean(), query: z.string().min(1), keywordVeto: regex,
}).strict();
export type RankingProfile = z.infer<typeof RankingProfileSchema>;
export function parseCsv(t: string) { const rows: string[][] = []; let r: string[] = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) { const c = t.charAt(i); if (q) { if (c === '"' && t[i+1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { r.push(f); f = ""; } else if (c === "\n") { r.push(f); rows.push(r); r = []; f = ""; } else if (c !== "\r") f += c; }
  if (f || r.length) { r.push(f); rows.push(r); } return rows; }
const norm = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, "").replace(/,? (inc|llc|ltd|corp)\.?$/,"").replace(/[^a-z0-9]+/g, " ").trim();
export function rankJobs(jobs: readonly JobListing[], profile: RankingProfile, topN = 50, trackerCsv?: string) {
  const titleInclude = new RegExp(profile.titleInclude, "i");
  const titleExclude = new RegExp(profile.titleExclude, "i");
  const locationPattern = new RegExp(profile.locationPattern, "i");
  const keywordVeto = new RegExp(profile.keywordVeto, "i");
// --- tracker (optional) ---
const dnr = new Set<string>(), applied = new Set<string>(), appliedCo = new Set<string>();
if (trackerCsv !== undefined) { const [h, ...rows] = parseCsv(trackerCsv); const ix = (n: string) => h?.findIndex(x => x.toLowerCase().startsWith(n)) ?? -1;
  for (const r of rows) { const co = norm((r[ix("company")] ?? "").split("(")[0] ?? ""); if (!co) continue; appliedCo.add(co);
    applied.add(co + "|" + norm(r[ix("role")] ?? "")); if (/yes/i.test(r[ix("do not")] ?? "") || /blacklist/i.test(r[ix("status")] ?? "")) dnr.add(co); } }
// --- filter ---

const stats = { total: jobs.length, titleMiss: 0, titleExcluded: 0, location: 0, veto: 0, doNotReapply: 0, alreadyApplied: 0 };
const pass = jobs.filter(j => { const co = norm(j.company);
  if (!titleInclude.test(j.title)) return stats.titleMiss++, false;
  if (titleExclude.test(j.title)) return stats.titleExcluded++, false;
  if (!(locationPattern.test(j.location) || (profile.allowRemote && j.remote))) return stats.location++, false;
  if (keywordVeto.test(j.descriptionText ?? "")) return stats.veto++, false;
  if (dnr.has(co)) return stats.doNotReapply++, false;
  if (applied.has(co + "|" + norm(j.title))) return stats.alreadyApplied++, false;
  return true; });
// --- BM25 ---
const tok = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const docs = pass.map(j => { const t = [...tok(j.title), ...tok(j.title), ...tok(j.title), ...tok(j.descriptionText ?? "")]; const tf = new Map<string, number>(); t.forEach(w => tf.set(w, (tf.get(w) ?? 0) + 1)); return { j, tf, len: t.length }; });
const avg = docs.reduce((s, d) => s + d.len, 0) / Math.max(docs.length, 1); const q = [...new Set(tok(profile.query))];
const df = new Map(q.map(w => [w, docs.filter(d => d.tf.has(w)).length]));
const k1 = 1.2, b = 0.75, N = docs.length;
const scored = docs.map(d => { let s = 0; for (const w of q) { const f = d.tf.get(w) ?? 0; if (!f) continue; const n = df.get(w)!; s += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * f * (k1 + 1) / (f + k1 * (1 - b + b * d.len / avg)); }
  return { score: +(s).toFixed(3), priorApplicantAtCompany: appliedCo.has(norm(d.j.company)), ...d.j, descriptionText: undefined }; })
  .sort((a, b) => b.score - a.score);
return { filterStats: { ...stats, passed: pass.length, trackerRows: applied.size, doNotReapplyCompanies: dnr.size }, top: scored.slice(0, topN) };
}
