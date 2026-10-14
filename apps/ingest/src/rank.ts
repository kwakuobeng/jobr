// Ranking stub: hard filters + BM25 over title(x3)+description for Kwaku (Kevin) Obeng's sales/RevOps profile.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { JobListing } from "./types.js";
const D = new URL("../../../data/", import.meta.url);
const TOPN = Number(process.env.TOPN ?? 50);
const TRACKER = process.env.TRACKER ?? "/workspace/kevin-obeng-application-tracker.csv";
const profile = {
  titleInclude: /\b(account executive|sales (development|representative|consultant|specialist|executive)|business development|bdr|sdr|inside sales|territory|revenue operations|revops|sales operations|sales ops|gtm operations|go-to-market operations|account manager|customer success manager|growth specialist|sales enablement)\b/i,
  titleExclude: /\b(director|vice president|vp|head of|chief|principal|staff|engineer|developer|intern|manager,? (sales|revenue)|sales manager|regional manager|area manager)\b/i,
  // Kevin is in DFW (Irving TX); accept US remote or Texas.
  locationOk: (j: JobListing) => /\b(tx|texas|dallas|irving|fort worth|austin|houston|plano|frisco)\b/i.test(j.location) || (j.remote && /\b(us|usa|united states|north america|americas|anywhere)\b|^remote$/i.test(j.location.trim()) ) || /^(remote|us remote|remote,? us.*|remote - us.*|united states.*)$/i.test(j.location.trim()),
  query: "account executive smb mid market inbound outbound quota pipeline salesforce hubspot crm prospecting closing saas revenue operations revops sales operations forecasting territory new business book of business demos discovery",
  keywordVeto: /\b(clearance required|ts\/sci|security clearance|commission only|1099)\b/i,
};
const norm = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, "").replace(/,? (inc|llc|ltd|corp)\.?$/,"").replace(/[^a-z0-9]+/g, " ").trim();
// --- tracker (optional) ---
const dnr = new Set<string>(), applied = new Set<string>(), appliedCo = new Set<string>();
function parseCsv(t: string) { const rows: string[][] = []; let r: string[] = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"' && t[i+1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { r.push(f); f = ""; } else if (c === "\n") { r.push(f); rows.push(r); r = []; f = ""; } else if (c !== "\r") f += c; }
  if (f || r.length) { r.push(f); rows.push(r); } return rows; }
if (existsSync(TRACKER)) { const [h, ...rows] = parseCsv(readFileSync(TRACKER, "utf8")); const ix = (n: string) => h.findIndex(x => x.toLowerCase().startsWith(n));
  for (const r of rows) { const co = norm((r[ix("company")] ?? "").split("(")[0]); if (!co) continue; appliedCo.add(co);
    applied.add(co + "|" + norm(r[ix("role")] ?? "")); if (/yes/i.test(r[ix("do not")] ?? "") || /blacklist/i.test(r[ix("status")] ?? "")) dnr.add(co); } }
// --- filter ---
const jobs: JobListing[] = JSON.parse(readFileSync(new URL("jobs-latest.json", D), "utf8"));
const stats: Record<string, number> = { total: jobs.length, titleMiss: 0, titleExcluded: 0, location: 0, veto: 0, doNotReapply: 0, alreadyApplied: 0 };
const pass = jobs.filter(j => { const co = norm(j.company);
  if (!profile.titleInclude.test(j.title)) return stats.titleMiss++, false;
  if (profile.titleExclude.test(j.title)) return stats.titleExcluded++, false;
  if (!profile.locationOk(j)) return stats.location++, false;
  if (profile.keywordVeto.test(j.descriptionText ?? "")) return stats.veto++, false;
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
  const tx = /\b(tx|texas|dallas|irving|fort worth|plano|frisco)\b/i.test(d.j.location) ? 1.15 : 1; // local boost
  const lvl = /\b(smb|mid[- ]market|commercial|associate|growth|inside|development)\b/i.test(d.j.title) ? 1.1 : /\benterprise|strategic|senior|sr\b/i.test(d.j.title) ? 0.9 : 1;
  return { score: +(s * tx * lvl).toFixed(3), priorApplicantAtCompany: appliedCo.has(norm(d.j.company)), ...d.j, descriptionText: undefined }; })
  .sort((a, b) => b.score - a.score);
const top = scored.slice(0, TOPN);
writeFileSync(new URL("ranked-top.json", D), JSON.stringify({ generatedAt: new Date().toISOString(), filterStats: { ...stats, passed: pass.length, trackerRows: applied.size, doNotReapplyCompanies: dnr.size }, top }, null, 2));
const md = [`# Jobr ranked report — ${new Date().toISOString().slice(0,10)}`, "", `Profile: sales (AE/SDR/BDR/territory) + RevOps, DFW or US-remote, non-director.`, "",
  `Filter funnel: ${JSON.stringify({ ...stats, passed: pass.length })}`, `Tracker: ${existsSync(TRACKER) ? TRACKER : "not found"} (${dnr.size} do-not-reapply companies)`, "",
  "| # | Score | Company | Title | Location | Note | Link |", "|---|---|---|---|---|---|---|",
  ...top.slice(0, 20).map((j, i) => `| ${i+1} | ${j.score} | ${j.company} | ${j.title.replace(/\|/g,"/")} | ${j.location.replace(/\|/g,"/")} | ${j.priorApplicantAtCompany ? "applied here before" : ""} | ${j.url} |`)].join("\n");
writeFileSync(new URL("ranked-report.md", D), md + "\n"); console.log(md);
