import { isIP } from "node:net";
import { Agent, request } from "undici";
import {
  assertPublicAddress,
  guardedLookup,
  resolveAddresses,
  validateUrl,
  type ResolveAddresses,
} from "../ingestion/ssrf-client";
import { hostRateLimiter, type HostRateLimiter } from "./rate_limiter";
export {
  SSRFBlockedError,
  assertPublicAddress,
  validateUrl,
} from "../ingestion/ssrf-client";
export class BodySizeError extends Error {}
export interface SafeFetchOptions {
  headers?: Record<string, string>;
  allowedHosts?: readonly string[];
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxRedirects?: number;
}
export interface SafeResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  url: string;
}
export type SafeFetch = (
  url: string,
  options?: SafeFetchOptions,
) => Promise<SafeResponse>;
async function beforeDeadline<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
export function createSafeFetch(
  resolve: ResolveAddresses = resolveAddresses,
  limiter: Pick<HostRateLimiter, "take"> = hostRateLimiter,
): SafeFetch {
  return async (value, options = {}) => {
    const timeout = options.timeoutMs ?? 15_000,
      maxBytes = options.maxBodyBytes ?? 5 * 1024 * 1024,
      maxRedirects = options.maxRedirects ?? 3;
    if (
      !Number.isInteger(timeout) ||
      timeout <= 0 ||
      timeout > 60_000 ||
      !Number.isInteger(maxBytes) ||
      maxBytes <= 0 ||
      maxBytes > 20 * 1024 * 1024 ||
      !Number.isInteger(maxRedirects) ||
      maxRedirects < 0 ||
      maxRedirects > 3
    )
      throw new Error("Invalid HTTP limits");
    const signal = AbortSignal.timeout(timeout);
    let url = validateUrl(value, options.allowedHosts),
      headers = { ...options.headers };
    let totalBytes = 0;
    for (let redirects = 0; ; redirects++) {
      signal.throwIfAborted();
      limiter.take(url.hostname);
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const family = isIP(hostname);
      const addresses = family
        ? [{ address: hostname, family }]
        : await beforeDeadline(resolve(hostname), signal);
      if (!addresses.length) throw new Error("DNS returned no addresses");
      addresses.forEach((record) => assertPublicAddress(record.address));
      const dispatcher = new Agent({
        connect: { lookup: guardedLookup(async () => addresses), timeout },
        maxResponseSize: maxBytes,
      });
      try {
        const response = await request(url, {
          dispatcher,
          method: "GET",
          headers,
          maxRedirections: 0,
          headersTimeout: timeout,
          bodyTimeout: timeout,
          signal,
        });
        const advertised = response.headers["content-length"];
        if (
          typeof advertised === "string" &&
          Number(advertised) + totalBytes > maxBytes
        )
          throw new BodySizeError("Response exceeds body limit");
        const chunks: Buffer[] = [];
        for await (const chunk of response.body) {
          signal.throwIfAborted();
          const bytes = Buffer.from(chunk);
          totalBytes += bytes.length;
          if (totalBytes > maxBytes)
            throw new BodySizeError("Response exceeds body limit");
          chunks.push(bytes);
        }
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          if (redirects >= maxRedirects) throw new Error("Too many redirects");
          const location = response.headers.location;
          if (typeof location !== "string")
            throw new Error("Redirect has no location");
          const next = validateUrl(
            new URL(location, url).href,
            options.allowedHosts,
          );
          if (next.origin !== url.origin) headers = {}; // Never forward credentials or identifying headers cross-origin.
          url = next;
          continue;
        }
        return {
          status: response.statusCode,
          headers: response.headers,
          text: Buffer.concat(chunks).toString("utf8"),
          url: url.href,
        };
      } finally {
        await dispatcher.destroy();
      }
    }
  };
}
export const safeFetch: SafeFetch = createSafeFetch();
