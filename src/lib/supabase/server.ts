import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicSupabaseConfig } from "./config";

export async function createClient() {
  const store = await cookies();
  const { url, key } = publicSupabaseConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        // RSC cannot write cookies; middleware persists refresh cookies first.
        // Route Handlers and Server Actions can write them here.
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch { /* Read-only RSC cookie store. */ }
      },
    },
  });
}
