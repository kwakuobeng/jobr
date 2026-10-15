"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/supabase/config";

export function AuthForm({ signup = false, next, callbackError = false }: { signup?: boolean; next?: string; callbackError?: boolean }) {
  const [error, setError] = useState(callbackError ? "The confirmation link could not be verified. Request a new link by signing up again, or sign in." : "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage(""); setPending(true);
    const fields = new FormData(event.currentTarget);
    try {
      const client = createClient();
      const credentials = { email: String(fields.get("email")).trim(), password: String(fields.get("password")) };
      const destination = safeNext(next);
      const result = signup
        ? await client.auth.signUp({ ...credentials, options: { data: { full_name: String(fields.get("full_name") ?? "").trim() }, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(destination)}` } })
        : await client.auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      if (result.data.session) window.location.assign(destination);
      else setMessage("Check your email to confirm your account, then return to sign in.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Authentication failed. Please try again."); }
    finally { setPending(false); }
  }
  const inputClass = "block w-full rounded border border-slate-400 p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-700";
  return <main className="mx-auto max-w-md space-y-5 p-8">
    <h1 className="text-2xl font-semibold">{signup ? "Create your Jobr account" : "Sign in to Jobr"}</h1>
    <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
      {error && <p role="alert" className="text-red-800">{error}</p>}
      <p role="status">{message || (pending ? "Please wait…" : "")}</p>
      {signup && <label className="block">Full name (optional)<input className={inputClass} name="full_name" autoComplete="name" maxLength={200} /></label>}
      <label className="block">Email<input className={inputClass} name="email" type="email" autoComplete="email" required maxLength={254} /></label>
      <label className="block">Password<input className={inputClass} name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={8} required /></label>
      <Button disabled={pending}>{pending ? "Please wait…" : signup ? "Create account" : "Sign in"}</Button>
    </form>
    <Link className="underline focus-visible:outline" href={`${signup ? "/sign-in" : "/sign-up"}?next=${encodeURIComponent(safeNext(next))}`}>{signup ? "Already have an account? Sign in" : "Create an account"}</Link>
  </main>;
}
