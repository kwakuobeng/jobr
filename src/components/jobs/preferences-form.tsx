"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { PreferencesRequest } from "../../../specs/api/contracts";
import { PreferencesInput, type Preferences } from "@/lib/jobs/model";
import { message, readJson } from "./api";
const workplace = ["remote", "hybrid", "onsite"] as const;
const employment = ["full_time", "part_time", "contract", "internship", "temporary"] as const;
export function PreferencesForm() {
  const [values, setValues] = useState<Preferences | null>(null);
  const [error, setError] = useState(""); const [status, setStatus] = useState("Loading preferences…"); const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/preferences", { signal: controller.signal }).then(readJson).then((data) => { setValues(PreferencesRequest.parse(data)); setStatus(""); }).catch((err: unknown) => { if (!controller.signal.aborted) { setError(message(err)); setStatus(""); } });
    return () => controller.abort();
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!values) return;
    setError(""); setSaving(true); setStatus("Saving…");
    const form = new FormData(event.currentTarget);
    const number = (name: string) => { const field = String(form.get(name) ?? "").trim(); return field === "" ? null : Number(field); };
    try {
      const input = PreferencesInput.parse({ ...values,
        allowed_workplace_types: form.getAll("workplace"), allowed_employment_types: form.getAll("employment"),
        hard_min_annual_salary_usd: number("salary"), max_commute_miles: number("commute"),
        allow_undisclosed_salary: form.has("undisclosed"), requires_visa_sponsorship: form.has("visa"),
        excluded_tech_slugs: String(form.get("tech") ?? "").split(",").map((slug) => slug.trim()).filter(Boolean),
      });
      const saved = await fetch("/api/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }).then(readJson);
      setValues(PreferencesRequest.parse(saved)); setStatus("Preferences saved.");
    } catch (err) { setError(message(err)); setStatus(""); }
    finally { setSaving(false); }
  }
  const inputClass = "block w-full max-w-md rounded border border-slate-400 p-2 focus-visible:outline focus-visible:outline-2";
  return <main className="space-y-5"><h1 className="text-2xl font-semibold">Preferences</h1>
    <p role="status">{status}</p>{error && <p role="alert" className="text-red-800">{error}</p>}
    {!values && error && <Button onClick={() => window.location.reload()}>Retry loading preferences</Button>}
    {values && <form onSubmit={save} className="space-y-5"><fieldset disabled={saving} className="space-y-5"><legend className="sr-only">Job hard filters</legend>
      <fieldset><legend>Workplace types (choose at least one)</legend>{workplace.map((value) => <label className="mr-5 inline-flex gap-2" key={value}><input type="checkbox" name="workplace" value={value} defaultChecked={values.allowed_workplace_types.includes(value)} />{value}</label>)}</fieldset>
      <fieldset><legend>Employment types (choose at least one)</legend>{employment.map((value) => <label className="mr-5 inline-flex gap-2" key={value}><input type="checkbox" name="employment" value={value} defaultChecked={values.allowed_employment_types.includes(value)} />{value.replaceAll("_", " ")}</label>)}</fieldset>
      <label className="block">Minimum annual salary (USD, optional)<input className={inputClass} type="number" min="0" max="2147483647" step="1" name="salary" defaultValue={values.hard_min_annual_salary_usd ?? ""} /></label>
      <label className="flex gap-2"><input name="undisclosed" type="checkbox" defaultChecked={values.allow_undisclosed_salary} />Allow undisclosed salary</label>
      <label className="flex gap-2"><input name="visa" type="checkbox" defaultChecked={values.requires_visa_sponsorship} />Require visa sponsorship</label>
      <label className="block">Maximum commute (miles, optional)<input className={inputClass} type="number" min="0" max="500" step="1" name="commute" defaultValue={values.max_commute_miles ?? ""} /></label>
      <p className="text-sm">Commute filtering also requires a saved home location. This form does not set your home location.</p>
      <label className="block">Excluded technology slugs (comma separated)<input className={inputClass} name="tech" defaultValue={values.excluded_tech_slugs.join(", ")} /></label>
      <Button type="submit">{saving ? "Saving…" : "Save preferences"}</Button>
    </fieldset></form>}
  </main>;
}
