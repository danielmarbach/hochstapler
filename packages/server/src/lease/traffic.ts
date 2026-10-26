// On-traffic handover (docs/DESIGN.md #91): a fresh instance asks the lease holder to hand over only once the first real
// request reaches it, i.e. after the deploy script has shifted the traffic. Health probes of the platform (Container Apps
// sends `kube-probe/<version>`) and the readiness/liveness checks of the deploy script never count. The user agent is
// only read for this decision and never recorded.
import type { IncomingHttpHeaders } from "node:http";

/** checks that must never start a handover (GET/HEAD, query ignored) */
const CHECK_PATHS = new Set(["/api/ready", "/api/live"]);

export interface TrafficRequest {
  method?: string | undefined;
  url?: string | undefined;
  headers: IncomingHttpHeaders;
}

/** Is this a real request (a visitor, a WebSocket upgrade, the deploy script's explicit trigger)? */
export function countsAsTraffic(req: TrafficRequest): boolean {
  if (req.headers["user-agent"]?.startsWith("kube-probe/")) return false;
  const method = req.method ?? "GET";
  const path = (req.url ?? "/").split("?")[0] ?? "/";
  return !((method === "GET" || method === "HEAD") && CHECK_PATHS.has(path));
}
