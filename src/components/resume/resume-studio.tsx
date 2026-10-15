"use client";
import { useCallback, useEffect, useState, type DragEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { message, readJson } from "@/components/jobs/api";
import { Chips, DOCX, PDF, ResumeView, validateFile, type ChipsValue, type ResumeValue } from "@/lib/resume-intake/model";

function ChipEditor({ label, values, onChange, maxLength, limit }: { label: string; values: string[]; onChange: (value: string[]) => void; maxLength: number; limit: number }) {
  const [draft, setDraft] = useState("");
  function add() {
    const value = draft.trim();
    if (value && values.length < limit && !values.some((item) => item.toLowerCase() === value.toLowerCase())) onChange([...values, value]);
    setDraft("");
  }
  return <fieldset className="space-y-3"><legend className="font-medium">{label}</legend>
    <ul className="flex flex-wrap gap-2">{values.map((value, index) => <li className="flex max-w-full items-center gap-2 break-words rounded-full bg-slate-100 py-1 pl-3 pr-1" key={`${value}-${index}`}><span>{value}</span><button type="button" className="rounded-full px-2 py-1 focus-visible:outline focus-visible:outline-2" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((_, position) => position !== index))}>×</button></li>)}</ul>
    <div className="flex flex-wrap gap-2"><label className="min-w-0 flex-1"><span className="sr-only">Add {label.toLowerCase()}</span><input className="w-full rounded border border-slate-400 p-2 focus-visible:outline focus-visible:outline-2" value={draft} maxLength={maxLength} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} /></label><Button variant="outline" type="button" disabled={!draft.trim() || values.length >= limit} onClick={add}>Add</Button></div>
  </fieldset>;
}
function sendFile(file: File, onParsing: () => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/resume");
    request.upload.onload = onParsing;
    request.timeout = 120000;
    request.onerror = () => reject(new Error("Upload connection failed. Retry with the same file."));
    request.ontimeout = () => reject(new Error("Upload timed out. Reload to check its status before retrying."));
    request.onload = () => { readJson(new Response(request.responseText, { status: request.status })).then(resolve, reject); };
    const form = new FormData(); form.set("file", file); request.send(form);
  });
}
export function ResumeStudio() {
  const [resume, setResume] = useState<ResumeValue | null>(null);
  const [chips, setChips] = useState<ChipsValue>({ skills: [], titles: [], years: null });
  const [approved, setApproved] = useState(false); const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); const [status, setStatus] = useState("Loading resume…"); const [error, setError] = useState("");
  const [selected, setSelected] = useState<File | null>(null);
  const apply = useCallback((value: ResumeValue | null) => {
    setResume(value); setChips(value?.chips ?? { skills: [], titles: [], years: null }); setApproved(value?.use_for_matching ?? false);
    setStatus(value?.parse_status === "completed" ? "Ready" : value?.parse_status === "failed" ? "Parsing failed. Retry with a text-based PDF or DOCX (up to 50 PDF pages)." : value ? "Parsing resume… If interrupted, upload the file again." : "");
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/resume", { signal: controller.signal }).then(readJson).then((value) => apply(ResumeView.nullable().parse(value))).catch((err: unknown) => { if (!controller.signal.aborted) { setError(message(err)); setStatus(""); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [apply]);
  useEffect(() => {
    if (busy || !resume || !["pending", "processing"].includes(resume.parse_status)) return;
    const controller = new AbortController();
    const interval = setInterval(() => {
      fetch("/api/resume", { signal: controller.signal }).then(readJson).then((value) => apply(ResumeView.nullable().parse(value))).catch((err: unknown) => { if (!controller.signal.aborted) setError(message(err)); });
    }, 2500);
    return () => { clearInterval(interval); controller.abort(); };
  }, [resume, busy, apply]);
  async function upload(file: File) {
    if (busy || loading) return; setError("");
    try { validateFile(file); } catch (err) { setError(message(err)); return; }
    setSelected(file); setBusy(true); setStatus("Uploading resume…");
    try { apply(ResumeView.parse(await sendFile(file, () => setStatus("Parsing resume…")))); }
    catch (err) { setError(message(err)); setStatus("Upload failed. Reload to check status, or retry."); }
    finally { setBusy(false); }
  }
  function drop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void upload(file); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!resume?.version_id) return;
    setBusy(true); setError(""); setStatus("Saving…");
    try {
      const body = { resume_id: resume.id, version_id: resume.version_id, chips: Chips.parse(chips), use_for_matching: approved };
      apply(ResumeView.parse(await fetch("/api/resume", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(readJson)));
      setStatus("Resume changes saved.");
    } catch (err) { setError(message(err)); setStatus(""); }
    finally { setBusy(false); }
  }
  return <main className="space-y-6"><h1 className="text-2xl font-semibold">Resume</h1>
    <p className="max-w-2xl text-slate-700">Upload a private resume to review suggested skills, titles and stated experience. Suggestions need your review; they are not verified facts.</p>
    <p role="status" aria-live="polite">{status}</p>{error && <p role="alert" className="text-red-800">{error}</p>}
    {!loading && !resume && <p>No resume yet. Upload a text-based PDF or DOCX to get started.</p>}
    <div className="rounded-xl border-2 border-dashed border-slate-400 p-6" onDragOver={(event) => event.preventDefault()} onDrop={drop} aria-busy={busy}>
      <label className="block space-y-3 font-medium"><span>Drop a PDF or DOCX here, or choose a file</span><input className="block w-full text-sm focus-visible:outline focus-visible:outline-2" type="file" accept={`${PDF},${DOCX},.pdf,.docx`} disabled={busy || loading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} /></label>
      <p className="mt-3 text-sm text-slate-600">Up to 10 MiB and 50 PDF pages. Scanned PDFs need OCR and cannot be parsed here. A new upload replaces the resume shown here; originals remain private.</p>
    </div>
    {resume && <p className="break-words text-sm">Current file: {resume.original_filename}</p>}
    {!busy && selected && (error || resume?.parse_status === "failed") && <Button variant="outline" onClick={() => void upload(selected)}>Retry selected file</Button>}
    {!loading && error && !resume && <Button variant="outline" onClick={() => window.location.reload()}>Reload resume</Button>}
    {resume?.parse_status === "completed" && <form onSubmit={save}><fieldset disabled={busy} className="max-w-2xl space-y-6"><legend className="sr-only">Review resume suggestions</legend>
      <ChipEditor label="Skills" values={chips.skills} maxLength={80} limit={100} onChange={(skills) => setChips({ ...chips, skills })} />
      <ChipEditor label="Titles" values={chips.titles} maxLength={120} limit={20} onChange={(titles) => setChips({ ...chips, titles })} />
      <label className="block">Years of experience (optional)<input className="mt-2 block w-32 rounded border border-slate-400 p-2 focus-visible:outline focus-visible:outline-2" type="number" min="0" max="80" step="0.1" value={chips.years ?? ""} onChange={(event) => setChips({ ...chips, years: event.target.value === "" ? null : Number(event.target.value) })} /></label>
      <p className="text-sm text-slate-600">Years are read from explicit experience statements, not calculated from employment dates. Review all chips against your original resume before saving.</p>
      <label className="flex gap-3"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />Use for matching</label>
      <p className="text-sm text-slate-600">Saves your approval for future matching integration. These chips do not change match rankings yet.</p>
      <Button type="submit">Save resume changes</Button>
    </fieldset></form>}
  </main>;
}
