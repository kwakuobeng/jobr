import { afterEach, describe, expect, it, vi } from "vitest";
import { isProtectedPath, publicSupabaseConfig, safeNext } from "@/lib/supabase/config";
afterEach(() => vi.unstubAllEnvs());
describe("auth boundaries", () => {
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/\nevil", "/auth/callback", "/sign-in", "", "/%2e%2e//evil.example"])("rejects unsafe or looping next %s", (path) => {
    expect(safeNext(path)).toBe("/app");
  });
  it("preserves local path and query", () => expect(safeNext("/matches?q=test")).toBe("/matches?q=test"));
  it("protects descendants without matching similarly named public paths", () => {
    expect(isProtectedPath("/matches/detail")).toBe(true);
    expect(isProtectedPath("/matches-other")).toBe(false);
  });
  it("fails closed without public env", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ""); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(publicSupabaseConfig).toThrow("NEXT_PUBLIC_SUPABASE_URL");
  });
});
