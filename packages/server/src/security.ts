// HTTP hardening (docs/DESIGN.md #46): response headers, CORS/Origin policy and the request allow-list.
// Rule: everything is denied unless the game really needs it. New routes MUST be added to API_ROUTES.
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import { z } from "zod";

export interface SecurityConfig {
  /** extra origins (besides the page's own host) that may call the API / open the WebSocket */
  allowedOrigins: string[];
  /** deployed behind HTTPS: adds HSTS and `upgrade-insecure-requests` (never for plain-HTTP LAN play) */
  httpsOnly: boolean;
}

const OriginSchema = z.string().refine((s) => {
  const u = URL.canParse(s) ? new URL(s) : null;
  return u !== null && (u.protocol === "http:" || u.protocol === "https:") && u.origin === s;
}, "muss ein Origin sein (z. B. https://spiel.example), ohne Pfad und ohne *");
const EnvSchema = z.object({
  ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((s) => s.trim().replace(/\/$/, ""))
        .filter(Boolean),
    )
    .pipe(z.array(OriginSchema)),
  HTTPS_ONLY: z
    .enum(["1", "true", "0", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export function loadSecurityConfig(
  env: NodeJS.ProcessEnv,
  override: Partial<SecurityConfig> = {},
): SecurityConfig {
  const parsed = EnvSchema.parse({
    ALLOWED_ORIGINS: env["ALLOWED_ORIGINS"],
    HTTPS_ONLY: env["HTTPS_ONLY"],
  });
  return {
    allowedOrigins: override.allowedOrigins ?? parsed.ALLOWED_ORIGINS,
    httpsOnly: override.httpsOnly ?? parsed.HTTPS_ONLY,
  };
}

// ---------- response headers ----------
/** 'self' also covers same-origin ws(s): in Chrome, Firefox and Safari >= 15.4. No inline script/style, no eval. */
const CSP_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' blob:",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
];
export function buildCsp(httpsOnly: boolean): string {
  return (httpsOnly ? [...CSP_DIRECTIVES, "upgrade-insecure-requests"] : CSP_DIRECTIVES).join("; ");
}

const DENIED_FEATURES = [
  "accelerometer",
  "autoplay",
  "bluetooth",
  "camera",
  "clipboard-read",
  "display-capture",
  "encrypted-media",
  "fullscreen",
  "gamepad",
  "geolocation",
  "gyroscope",
  "hid",
  "idle-detection",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "publickey-credentials-get",
  "screen-wake-lock",
  "serial",
  "usb",
  "xr-spatial-tracking",
];
/** the copy-link buttons write to the clipboard, the share button uses the Web Share API */
export const PERMISSIONS_POLICY = [
  ...DENIED_FEATURES.map((f) => `${f}=()`),
  "clipboard-write=(self)",
  "web-share=(self)",
].join(", ");

export const HSTS = "max-age=31536000; includeSubDomains";

/** Headers for every response (API, static, errors). Node sends no Server / X-Powered-By banner. */
export function applySecurityHeaders(res: ServerResponse, cfg: SecurityConfig): void {
  res.setHeader("content-security-policy", buildCsp(cfg.httpsOnly));
  if (cfg.httpsOnly) {
    res.setHeader("strict-transport-security", HSTS);
  }
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("permissions-policy", PERMISSIONS_POLICY);
  res.setHeader("cross-origin-opener-policy", "same-origin");
  res.setHeader("cross-origin-resource-policy", "same-origin");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("cache-control", "no-store");
}

/** Vite content-hashed bundle files (`name-<8 chars>.ext`) may be cached forever; models are not hashed. */
export function staticCacheControl(relPath: string): string {
  const rel = relPath.replaceAll("\\", "/");
  if (rel === "index.html" || rel === "version.json") {
    return "no-store";
  }
  const hashed =
    rel.startsWith("assets/") &&
    !rel.startsWith("assets/models/") &&
    /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/.test(rel);
  return hashed ? "public, max-age=31536000, immutable" : "no-cache";
}

// ---------- origins / CORS ----------
/**
 * Browsers always send `Origin` on WebSocket upgrades and cross-origin fetches. Same origin = same host as the request's
 * `Host` header (Caddy keeps it); anything else must be listed in ALLOWED_ORIGINS. A missing Origin is a non-browser
 * client (bots, curl, tests): it cannot ride on a victim's browser, so it is allowed.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  host: string | undefined,
  allowed: readonly string[],
): boolean {
  if (origin === undefined) {
    return true;
  }
  if (allowed.includes(origin)) {
    return true;
  }
  if (!host || !URL.canParse(origin)) {
    return false;
  }
  const u = new URL(origin);
  return (u.protocol === "http:" || u.protocol === "https:") && u.host === host.toLowerCase();
}

/** CORS headers only for explicitly allowed foreign origins; same-origin needs none. */
export function applyCors(
  res: ServerResponse,
  origin: string | undefined,
  cfg: SecurityConfig,
  preflight: boolean,
): void {
  if (origin === undefined || !cfg.allowedOrigins.includes(origin)) {
    return;
  }
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "Origin");
  res.setHeader("cross-origin-resource-policy", "cross-origin");
  if (preflight) {
    res.setHeader("access-control-allow-headers", "content-type, x-player-token, x-pow-solution");
    res.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE");
    res.setHeader("access-control-max-age", "600");
  }
}

// ---------- request allow-list ----------
export const MAX_URL_LENGTH = 2048;
export const MAX_BODY_BYTES = 64 * 1024;

export interface Rejection {
  status: number;
  message: string;
  allow?: string;
}

const GAME = "/api/games/[A-Za-z0-9]{1,32}";
/** every public route and the methods it accepts (HEAD is implied by GET) */
const API_ROUTES: readonly { re: RegExp; template: string; methods: readonly string[] }[] = [
  { re: /^\/api\/themes$/, template: "/api/themes", methods: ["GET"] },
  { re: /^\/api\/ready$/, template: "/api/ready", methods: ["GET"] },
  { re: /^\/api\/games$/, template: "/api/games", methods: ["POST"] },
  { re: /^\/api\/pow\/challenge$/, template: "/api/pow/challenge", methods: ["POST"] },
  { re: new RegExp(`^${GAME}$`), template: "/api/games/:id", methods: ["GET"] },
  { re: new RegExp(`^${GAME}/join$`), template: "/api/games/:id/join", methods: ["POST"] },
  { re: new RegExp(`^${GAME}/bots$`), template: "/api/games/:id/bots", methods: ["POST"] },
  {
    re: new RegExp(`^${GAME}/seats/p[1-9][0-9]?$`),
    template: "/api/games/:id/seats/:seat",
    methods: ["DELETE"],
  },
  { re: new RegExp(`^${GAME}/seats/me$`), template: "/api/games/:id/seats/me", methods: ["PATCH"] },
  {
    re: new RegExp(`^${GAME}/seats/me/token$`),
    template: "/api/games/:id/seats/me/token",
    methods: ["POST"],
  },
  { re: new RegExp(`^${GAME}/settings$`), template: "/api/games/:id/settings", methods: ["PATCH"] },
  { re: new RegExp(`^${GAME}/chat$`), template: "/api/games/:id/chat", methods: ["PATCH"] },
  { re: new RegExp(`^${GAME}/start$`), template: "/api/games/:id/start", methods: ["POST"] },
];

/**
 * Low-cardinality route label for telemetry: the matching API_ROUTES template ("/api/games/:id/join"), "unmatched" for
 * unknown API paths, "static" for everything else. Never contains ids or raw URLs (docs/DESIGN.md #54).
 */
export function routeTemplate(pathname: string): string {
  if (pathname !== "/api" && !pathname.startsWith("/api/"))
    return pathname === "/ws" ? "/ws" : "static";
  if (pathname.startsWith("/api/test/")) return "/api/test/*";
  return API_ROUTES.find((r) => r.re.test(pathname))?.template ?? "unmatched";
}

/** URL length, method and path allow-list. `testMode` unlocks `/api/test/*` (never true in production). */
export function routeRejection(
  method: string,
  target: string,
  testMode: boolean,
): Rejection | null {
  if (target.length > MAX_URL_LENGTH) {
    return { status: 414, message: "URL zu lang." };
  }
  const path = target.split("?")[0] ?? "";
  if (path !== "/api" && !path.startsWith("/api/")) {
    return method === "GET" || method === "HEAD"
      ? null
      : { status: 405, message: "Methode nicht erlaubt.", allow: "GET, HEAD" };
  }
  if (testMode && path.startsWith("/api/test/")) {
    return null;
  }
  const route = API_ROUTES.find((r) => r.re.test(path));
  if (!route) {
    return { status: 404, message: "Unbekannter Endpunkt." };
  }
  const methods = route.methods.includes("GET") ? [...route.methods, "HEAD"] : [...route.methods];
  return methods.includes(method)
    ? null
    : { status: 405, message: "Methode nicht erlaubt.", allow: methods.join(", ") };
}

/** Bodies (POST/PATCH) must be JSON and within the size limit; checked before a byte is read. */
export function bodyRejection(method: string, headers: IncomingHttpHeaders): Rejection | null {
  if (method !== "POST" && method !== "PATCH") {
    return null;
  }
  const length = Number(headers["content-length"] ?? 0);
  const hasBody = length > 0 || headers["transfer-encoding"] !== undefined;
  if (!hasBody) {
    return null;
  }
  if (length > MAX_BODY_BYTES) {
    return { status: 413, message: "Body zu gross." };
  }
  const type = (headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  return type === "application/json"
    ? null
    : { status: 415, message: "Content-Type muss application/json sein." };
}

/** Static files: no dotfiles / dot directories (and no `..`) anywhere in the requested path. */
export function hasDotSegment(decodedPath: string): boolean {
  return decodedPath.split(/[\\/]/).some((s) => s.startsWith("."));
}
