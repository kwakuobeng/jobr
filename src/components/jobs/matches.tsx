"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FeedRequest, PreferencesRequest } from "../../../specs/api/contracts";
import { z } from "zod";
import type { Match } from "@/lib/jobs/model";
import { message, readJson } from "./api";
export function Matches() {
  const [profileId, setProfileId] = useState(""); const [matches, setMatches] = useState<Match[] | null>(null);
  const [pending, setPending] = useState(true); const [error, setError] = useState("");
  async function load(id: string, query: string, stretch: boolean, limit: number, signal?: AbortSignal, filters: Partial<z.infer<typeof FeedRequest>> = {}) {
    const input = FeedRequest.parse({ candidate_profile_id: id, query, include_stretch_exceptions: stretch, limit, ...filters });
    const result = await fetch("/api/matches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal }).then(readJson);
    setMatches(z.array(z.object({ canonical_job_id: z.string().uuid(), title: z.string() }).passthrough()).parse(result) as unknown as Match[]);
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/preferences", { signal: controller.signal }).then(readJson).then(async (data) => {
      const prefs = PreferencesRequest.parse(data); setProfileId(prefs.candidate_profile_id);
      await load(prefs.candidate_profile_id, "", false, 20, controller.signal);
    }).catch((err: unknown) => { if (!controller.signal.aborted) setError(message(err)); }).finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => controller.abort();
  }, []);
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setPending(true); setError(""); setMatches(null);
    const title_keywords = String(form.get("title_keywords") ?? "").split(",").map((v) => v.trim()).filter(Boolean).slice(0, 10);
    try { await load(profileId, String(form.get("query") ?? ""), form.has("stretch"), Number(form.get("limit")), undefined, { title_keywords, us_or_remote_only: form.has("us_or_remote"), region: String(form.get("region") ?? "all") as "all", sort: String(form.get("sort") ?? "best") as "best", workplace_order: String(form.get("workplace_order") ?? "Remote,Hybrid,Onsite").split(",") as Array<"Remote">, ...(String(form.get("sort_zip") ?? "").trim() ? { sort_zip: String(form.get("sort_zip")).trim() } : {}) }); }
    catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  return <main className="space-y-5"><h1 className="text-2xl font-semibold">Matches</h1>
    <form onSubmit={search} className="space-y-3"><fieldset disabled={pending || !profileId} className="space-y-3"><legend className="sr-only">Find matching roles</legend>
      <label className="block">Search roles<input name="query" maxLength={1000} className="mt-2 block w-full rounded border border-slate-400 p-2 focus-visible:outline focus-visible:outline-2" /></label>
      <p className="text-sm text-slate-600">Multi-word searches match as a phrase (e.g. account executive). Use quotes or &quot;or&quot; for advanced searches.</p>
      <label className="block">Title must include (optional, comma-separated)<input name="title_keywords" maxLength={400} placeholder="account executive, sales, business development" className="mt-2 block w-full rounded border border-slate-400 p-2 focus-visible:outline focus-visible:outline-2" /></label>
      <label className="flex gap-2"><input name="us_or_remote" type="checkbox" />US or Remote only</label>
      <p className="text-sm text-slate-600">These filters apply to this search only and check the job title and location, not the description.</p>
      <fieldset className="flex flex-wrap gap-4"><legend className="font-medium">Job location</legend>{(["all", "us", "non_us", "unknown"] as const).map((r) => <label key={r} className="flex gap-2"><input type="radio" name="region" value={r} defaultChecked={r === "all"} />{{ all: "All", us: "US", non_us: "Non-US", unknown: "Region unknown" }[r]}</label>)}</fieldset>
      <p className="text-sm text-slate-600">Remote roles count by their stated region (e.g. &quot;Remote - US&quot; is US).</p>
      <label className="block">Sort by<select name="sort" defaultValue="best" className="ml-3 rounded border border-slate-400 p-2"><option value="best">Best match</option><option value="workplace">Workplace</option><option value="distance">Distance from ZIP</option><option value="compensation">Compensation</option><option value="newest">Newest</option></select></label>
      <label className="block">Workplace order<select name="workplace_order" defaultValue="Remote,Hybrid,Onsite" className="ml-3 rounded border border-slate-400 p-2"><option value="Remote,Hybrid,Onsite">Remote, Hybrid, Onsite</option><option value="Hybrid,Remote,Onsite">Hybrid, Remote, Onsite</option><option value="Onsite,Hybrid,Remote">Onsite, Hybrid, Remote</option></select></label>
      <label className="block">ZIP for distance (optional; defaults to your home ZIP)<input name="sort_zip" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} className="ml-3 rounded border border-slate-400 p-2" /></label>
      <p className="text-sm text-slate-600">Roles without coordinates sort last and show &quot;Distance unknown&quot;. Unknown salaries sort last.</p>
      <label className="block">Maximum results<input name="limit" type="number" min="1" max="50" defaultValue="20" required className="ml-3 w-20 rounded border border-slate-400 p-2" /></label>
      <label className="flex gap-2"><input name="stretch" type="checkbox" />Include stretch exceptions (relaxes your hard filters)</label>
      <Button>Search</Button>
    </fieldset></form>
    <p role="status">{pending ? "Loading matches…" : matches ? `${matches.length} matching roles.` : ""}</p>
    {error && <div role="alert"><p className="text-red-800">{error}</p>{!profileId && <Button onClick={() => window.location.reload()}>Retry loading matches</Button>}</div>}
    {!pending && matches?.length === 0 && <p>No eligible roles found. Try another query or <a href="/preferences" className="underline">adjust your preferences</a>. Jobs will appear as source data becomes available.</p>}
    <ul className="space-y-4">{matches?.map((job) => <li key={job.canonical_job_id}><article className="min-w-0 space-y-3 break-words rounded-xl border border-slate-300 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-xl font-bold">{job.title}</h2><p className="mt-1 font-medium text-slate-700">{job.employer_name}</p></div><span className="rounded-full bg-indigo-100 px-3 py-1 text-sm font-bold" aria-label={`Match score ${job.match_score} out of 10`}>Match {job.match_score}/10</span><span className="rounded-full bg-slate-100 px-3 py-1 text-sm" title="Inferred from the job's location; Jobr stores no employer headquarters data.">{job.company_origin}</span><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold" title={job.workplace_inferred ? "Inferred from the job title or location text; the source did not state a workplace type." : undefined}>{job.workplace_type}{job.workplace_inferred && <span className="ml-1 text-xs font-normal text-slate-600">(likely)</span>}</span></div>
      {job.match_reason && <p className="text-sm text-emerald-800">{job.match_reason}</p>}{job.location_label && <p>{job.location_label}</p>}{(job.posted_label || job.distance_label) && <p className="text-sm text-slate-600">{[job.posted_label, job.distance_label].filter(Boolean).join(" · ")}</p>}<p className="text-sm text-slate-600">{job.employment_type.replaceAll("_", " ")}</p>
      {(job.min_annual_salary_usd !== null || job.max_annual_salary_usd !== null) && <p>Annual salary (USD): {job.min_annual_salary_usd?.toLocaleString("en-US") ?? "undisclosed"} – {job.max_annual_salary_usd?.toLocaleString("en-US") ?? "undisclosed"}{job.is_salary_estimated ? " (estimated)" : ""}</p>}
      <details className="text-sm text-slate-600"><summary className="cursor-pointer focus-visible:outline">Match details</summary><ul className="mt-2 list-disc pl-5"><li>{job.fit.keyword_text}</li><li>{job.fit.semantic_text}</li><li>{job.fit.overall_text}</li></ul>
        <p className="mt-2">Match score: rank within these results (1-7) plus bonuses for a title hit (+1.5), meeting your salary floor (+1) and an allowed workplace (+0.5), capped at 10.</p>
        <details className="mt-2"><summary className="cursor-pointer focus-visible:outline">Technical details</summary><p className="mt-1">Lexical: {job.lexical_rank.toFixed(3)} · Semantic: {job.semantic_similarity.toFixed(3)} · RRF: {job.rrf_score.toFixed(4)}</p></details></details>
      <div className="flex flex-wrap gap-5">{job.canonical_posting_url && <a className="underline focus-visible:outline" href={job.canonical_posting_url} target="_blank" rel="noopener noreferrer">View source</a>}{job.application_url && <a className="underline focus-visible:outline" href={job.application_url} target="_blank" rel="noopener noreferrer">Open employer application</a>}</div>
      <p className="text-sm">External links open in a new tab. Jobr does not submit applications.</p>
    </article></li>)}</ul>
  </main>;
}
