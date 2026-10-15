import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isProtectedPath, publicSupabaseConfig } from "./config";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const protectedRoute = isProtectedPath(request.nextUrl.pathname);
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  // Public shell and anonymous redirects work even before auth is configured.
  if (!configured) {
    if (!protectedRoute) return response;
  } else {
    const { url, key } = publicSupabaseConfig();
    const client = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { data: { user }, error } = await client.auth.getUser();
    if (!protectedRoute || (user && !error)) {
      if (protectedRoute) response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
  }
  const target = request.nextUrl.clone();
  target.pathname = "/sign-in";
  target.search = "";
  target.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  const redirect = NextResponse.redirect(target);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  redirect.headers.set("Cache-Control", "private, no-store");
  return redirect;
}
