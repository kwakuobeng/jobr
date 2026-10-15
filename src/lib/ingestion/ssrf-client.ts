import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, request } from "undici";

export class SSRFBlockedError extends Error {
  constructor(message = "Blocked outbound destination") {
    super(message);
    this.name = "SSRFBlockedError";
  }
}
export function assertPublicAddress(address: string): void {
  if (!ipaddr.isValid(address))
    throw new SSRFBlockedError("Invalid IP address");
  const parsed = ipaddr.process(address);
  if (parsed.range() !== "unicast")
    throw new SSRFBlockedError("Non-public IP address");
}
export function validateUrl(
  value: string,
  allowedHosts?: readonly string[],
): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password
  )
    throw new SSRFBlockedError(
      "HTTPS on port 443 without credentials required",
    );
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (ipaddr.isValid(hostname)) assertPublicAddress(hostname);
  else if (
    !hostname.includes(".") ||
    hostname.endsWith(".") ||
    /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(hostname)
  )
    throw new SSRFBlockedError();
  if (allowedHosts && !allowedHosts.includes(hostname))
    throw new SSRFBlockedError("Host is not allowlisted");
  return url;
}
export type ResolveAddresses = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;
export const resolveAddresses: ResolveAddresses = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });
// The validated address is handed directly to the socket. No second DNS lookup is possible.
export function guardedLookup(
  resolve: ResolveAddresses = resolveAddresses,
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname)
      .then((addresses) => {
        if (!addresses.length) throw new SSRFBlockedError("Empty DNS answer");
        addresses.forEach((record) => assertPublicAddress(record.address));
        const wanted = typeof options === "number" ? options : options.family;
        const eligible = wanted
          ? addresses.filter((record) => record.family === wanted)
          : addresses;
        if (!eligible.length)
          throw new SSRFBlockedError("No address for requested family");
        if (typeof options === "object" && options.all)
          callback(null, eligible);
        else callback(null, eligible[0]!.address, eligible[0]!.family);
      })
      .catch((error: Error) => callback(error, "", 0));
  };
}
export interface HttpResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}
export type HttpClient = (
  url: string,
  headers?: Record<string, string>,
) => Promise<HttpResult>;
export interface SafeClientOptions {
  // Inject a resolver (e.g. DNS-over-HTTPS on runtimes without usable system DNS).
  // Every returned address is still checked by assertPublicAddress before connecting.
  resolve?: ResolveAddresses;
}
export function createSafeClient(
  allowedHosts?: readonly string[],
  options: SafeClientOptions = {},
): HttpClient {
  return async (value, headers = {}) => {
    const url = validateUrl(value, allowedHosts);
    const dispatcher = new Agent({
      connect: { lookup: guardedLookup(options.resolve), timeout: 5_000 },
      maxResponseSize: 5 * 1024 * 1024,
    });
    try {
      const response = await request(url, {
        dispatcher,
        method: "GET",
        headers,
        maxRedirections: 0,
        headersTimeout: 10_000,
        bodyTimeout: 10_000,
        signal: AbortSignal.timeout(15_000),
      });
      const text = await response.body.text();
      return { status: response.statusCode, headers: response.headers, text };
    } finally {
      await dispatcher.close();
    }
  };
}
export const safeGet = createSafeClient();
