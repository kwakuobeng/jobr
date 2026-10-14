import { safeGet, type HttpClient } from "./ssrf-client";
import type { ActiveResult } from "./types";
export async function verifyUrlActive(
  url: string,
  validThrough?: string,
  client: HttpClient = safeGet,
  now = Date.now(),
): Promise<ActiveResult> {
  if (validThrough) {
    const expiry = Date.parse(
      validThrough.length === 10
        ? `${validThrough}T23:59:59.999Z`
        : validThrough,
    );
    if (!Number.isFinite(expiry)) throw new Error("Invalid expiration date");
    if (expiry < now)
      return {
        isActive: false,
        httpStatus: 0,
        closedReason: "expired_valid_through",
      };
  }
  const result = await client(url);
  if (result.status === 404 || result.status === 410)
    return {
      isActive: false,
      httpStatus: result.status,
      closedReason: result.status === 404 ? "http_404" : "http_410",
    };
  // Redirects and outages are ambiguous; caller must retain state and retry, not mark closed.
  if (result.status !== 200)
    throw new Error(`Active verification inconclusive: HTTP ${result.status}`);
  return { isActive: true, httpStatus: 200 };
}
