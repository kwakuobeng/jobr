export function publicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable authentication.");
  return { url, key };
}

export function safeNext(value: unknown, fallback = "/app"): string {
  if (typeof value !== "string" || !value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://jobr.example");
    if (url.origin !== "https://jobr.example" || url.pathname.startsWith("//") || /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(url.pathname) || url.pathname.startsWith("/auth/") || ["/sign-in", "/sign-up"].includes(url.pathname)) return fallback;
    return url.pathname + url.search + url.hash;
  } catch { return fallback; }
}

export function isProtectedPath(path: string) {
  return ["/app", "/matches", "/preferences"].some((root) => path === root || path.startsWith(root + "/"));
}
