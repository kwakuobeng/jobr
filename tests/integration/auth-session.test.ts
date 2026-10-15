import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (cookies: { name: string; value: string; options: { path: string; httpOnly: boolean } }[]) => void } }) => ({
    auth: { getUser: async () => {
      options.cookies.setAll([{ name: "sb-test-auth-token", value: "refreshed", options: { path: "/", httpOnly: true } }]);
      return { data: { user: state.user }, error: null };
    } },
  }),
}));
import { updateSession } from "@/lib/supabase/middleware";
beforeEach(() => {
  state.user = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-public-key");
});
afterEach(() => vi.unstubAllEnvs());
it("preserves refreshed cookies on an anonymous redirect", async () => {
  const response = await updateSession(new NextRequest("https://jobr.example/matches?q=hello"));
  expect(response.status).toBe(307);
  expect(new URL(response.headers.get("location")!).searchParams.get("next")).toBe("/matches?q=hello");
  expect(response.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
});
it("passes a verified user and refreshes request and response cookies", async () => {
  state.user = { id: "user-id" };
  const request = new NextRequest("https://jobr.example/app");
  const response = await updateSession(request);
  expect(response.headers.get("location")).toBeNull();
  expect(request.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
  expect(response.cookies.get("sb-test-auth-token")?.httpOnly).toBe(true);
});
