import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";
export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) redirect("/sign-in");
  return <div className="mx-auto max-w-5xl p-6">
    <nav aria-label="Account" className="mb-8 flex flex-wrap items-center gap-5">
      <Link href="/app" className="underline focus-visible:outline">Account</Link>
      <Link href="/matches" className="underline focus-visible:outline">Matches</Link>
      <Link href="/preferences" className="underline focus-visible:outline">Preferences</Link>
      <form action={signOut}><Button variant="outline">Sign out</Button></form>
    </nav>{children}
  </div>;
}
