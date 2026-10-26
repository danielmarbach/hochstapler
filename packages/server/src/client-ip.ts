// Client address for rate limits (docs/DESIGN.md #59). The address is only ever used as an in-memory map key:
// it is never logged, never put into telemetry and never persisted (AGENTS.md secrets rule).
import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import proxyaddr from "proxy-addr";
import { z } from "zod";

const TrustProxySchema = z.coerce.number().int().min(0).max(10).default(0);

/**
 * `TRUST_PROXY_HOPS=<n>`: how many reverse proxies in front of the app append to `x-forwarded-for`
 * (Azure Container Apps ingress: 1, Caddy: 1, direct/LAN: 0). Invalid values abort the start.
 */
export function loadTrustProxyHops(env: NodeJS.ProcessEnv): number {
  return TrustProxySchema.parse(env["TRUST_PROXY_HOPS"]);
}

export interface AddressSource {
  socket: { remoteAddress?: string | undefined };
  headers: Record<string, string | string[] | undefined>;
}

/** "1.2.3.4:5678" / "[::1]:443" / "::FFFF:1.2.3.4" -> canonical address, or null when it is not an IP. */
function normalise(raw: string): string | null {
  let a = raw.trim();
  if (a.startsWith("[")) {
    const end = a.indexOf("]");
    const rest = a.slice(end + 1);
    if (end < 0 || (rest !== "" && !/^:\d+$/.test(rest))) {
      return null;
    }
    a = a.slice(1, end);
  } else if (a.indexOf(":") === a.lastIndexOf(":") && a.includes(":")) {
    // exactly one colon: "ipv4:port"
    a = a.slice(0, a.indexOf(":"));
  }
  a = a.toLowerCase();
  if (a.startsWith("::ffff:") && isIP(a.slice(7)) === 4) {
    a = a.slice(7);
  }
  return isIP(a) === 0 ? null : a;
}

/**
 * The address a request counts under. By default the socket's remote address. With `trustedHops` > 0 the entry
 * that many places from the RIGHT of `x-forwarded-for` (the one the outermost trusted proxy appended), found by
 * `proxy-addr` with the trust function `(addr, i) => i < trustedHops` (index 0 is the socket). Entries to its left are
 * whatever the client sent and are never used. If the header is shorter than the trusted chain (the request did not
 * come through the proxy) or the entry is not an IP, the socket address is used.
 */
export function clientIp(req: AddressSource, trustedHops: number): string {
  const remote = req.socket.remoteAddress;
  const socket = normalise(remote ?? "") ?? "unknown";
  if (trustedHops <= 0) {
    return socket;
  }
  const header = req.headers["x-forwarded-for"];
  // proxy-addr reads exactly these two properties (`connection.remoteAddress`, `headers["x-forwarded-for"]`)
  const view = {
    connection: { remoteAddress: remote },
    headers: { "x-forwarded-for": Array.isArray(header) ? header.join(",") : header },
  } as unknown as IncomingMessage;
  // proxy-addr stops at the leftmost entry when the chain is shorter than the trusted hops, which would be a
  // client-chosen value: the socket address counts instead
  if (proxyaddr.all(view).length <= trustedHops) {
    return socket;
  }
  const entry = proxyaddr(view, (_addr: string, i: number) => i < trustedHops);
  return normalise(entry) ?? socket;
}

/**
 * Key for per-client limits: IPv4 as is, IPv6 collapsed to its /64 (one subscriber usually owns a whole /64, so
 * rotating through its addresses must not yield fresh buckets). Input is a canonical address from `clientIp`.
 */
export function limitKey(ip: string): string {
  if (isIP(ip) !== 6) {
    return ip;
  }
  const [head = "", tail = ""] = ip.split("::");
  const front = head === "" ? [] : head.split(":");
  const back = ip.includes("::") && tail !== "" ? tail.split(":") : [];
  const groups = ip.includes("::")
    ? [...front, ...Array<string>(8 - front.length - back.length).fill("0"), ...back]
    : front;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}
