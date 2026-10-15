import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export function middleware(request: NextRequest) { return updateSession(request); }
export const config = {
  matcher: ["/app/:path*", "/matches/:path*", "/preferences/:path*", "/sign-in", "/sign-up", "/auth/callback"],
};
