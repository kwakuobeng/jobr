"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FeedRequest, PreferencesRequest } from "../../../specs/api/contracts";
import { mapMatches, type Match } from "@/lib/jobs/model";
import { message, readJson } from "./api";
export function Matches() {
  const [profileId, setProfileId] = useState(""); const [matches, setMatches] = useState<Match[] | null>(null);
  const [pending, setPending] = useState(true); const [error, setError] = useState("");
  async function load(id: string, query: string, stretch: boolean, limit: number, signal?: AbortSignal) {
    const input = FeedRequest.parse({ candidate_profile_id: id, query, include_stretch_exceptions: stretch, limit });
    const result = await fetch("/api/matches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal }).then(readJson);
    setMatches(mapMatches(result));
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
    try { await load(profileId, String(form.get("query") ?? ""), form.has("stretch"), Number(form.get("limit"))); }
    catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  return <main className="space-y-5"><h1 className="text-2xl font-semibold">Matches</h1>
    <form onSubmit={search} className="space-y-3"><fieldset disabled={pending || !profileId} className="space-y-3"><legend className="sr-only">Find matching roles</legend>
      <label className="block">Search roles<input name="query" maxLength={1000} className="ml-3 rounded border border-slate-400 p-2 focus-visible:outline focus-visible:outline-2" /></label>
      <label className="block">Maximum results<input name="limit" type="number" min="1" max="50" defaultValue="20" required className="ml-3 w-20 rounded border border-slate-400 p-2" /></label>
      <label className="flex gap-2"><input name="stretch" type="checkbox" />Include stretch exceptions (relaxes your hard filters)</label>
      <Button>Search</Button>
    </fieldset></form>
    <p role="status">{pending ? "Loading matches…" : matches ? `${matches.length} matching roles.` : ""}</p>
    {error && <div role="alert"><p className="text-red-800">{error}</p>{!profileId && <Button onClick={() => window.location.reload()}>Retry loading matches</Button>}</div>}
    {!pending && matches?.length === 0 && <p>No eligible roles found. Try another query or adjust your preferences. Jobs will appear as source data becomes available.</p>}
    <ul className="space-y-4">{matches?.map((job) => <li key={job.canonical_job_id}><article className="space-y-2 rounded border border-slate-300 p-4">
      <h2 className="text-xl font-semibold">{job.title}</h2><p>{job.employer_name}</p><p>{job.workplace_type} · {job.employment_type.replaceAll("_", " ")}</p>
      {(job.min_annual_salary_usd !== null || job.max_annual_salary_usd !== null) && <p>Annual salary (USD): {job.min_annual_salary_usd?.toLocaleString("en-US") ?? "undisclosed"} – {job.max_annual_salary_usd?.toLocaleString("en-US") ?? "undisclosed"}{job.is_salary_estimated ? " (estimated)" : ""}</p>}
      <p className="text-sm">Lexical: {job.lexical_rank.toFixed(3)} · Semantic: {job.semantic_similarity.toFixed(3)} · RRF: {job.rrf_score.toFixed(4)}</p>
      <div className="flex flex-wrap gap-5">{job.canonical_posting_url && <a className="underline focus-visible:outline" href={job.canonical_posting_url} target="_blank" rel="noopener noreferrer">View source</a>}{job.application_url && <a className="underline focus-visible:outline" href={job.application_url} target="_blank" rel="noopener noreferrer">Open employer application</a>}</div>
      <p className="text-sm">External links open in a new tab. Jobr does not submit applications.</p>
    </article></li>)}</ul>
  </main>;
}
