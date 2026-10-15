import { createClient } from "@/lib/supabase/server";
export default async function AccountPage() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  return <main><h1 className="text-2xl font-semibold">Your Jobr account</h1><p className="mt-3">Signed in as {user?.email}.</p><p className="mt-3">Use Sign out to end your session on this device.</p></main>;
}
