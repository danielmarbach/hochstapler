// Security hardening (docs/DESIGN.md #46): headers, CORS/Origin, route allow-list, test-mode isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import WebSocket from "ws";
import { startServer } from "../src/server.ts";
import type { RunningServer } from "../src/server.ts";
import { isTestModeEnabled } from "../src/test-mode.ts";
import {
  PERMISSIONS_POLICY,
  buildCsp,
  isAllowedOrigin,
  loadSecurityConfig,
  routeRejection,
} from "../src/security.ts";

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
  "font-src 'self'; connect-src 'self' blob:; manifest-src 'self'; worker-src 'self'; base-uri 'none'; " +
  "form-action 'self'; frame-ancestors 'none'; object-src 'none'";

describe("pure helpers", () => {
  it("builds the exact CSP, optionally with upgrade-insecure-requests", () => {
    expect(buildCsp(false)).toBe(CSP);
    expect(buildCsp(true)).toBe(`${CSP}; upgrade-insecure-requests`);
  });
  it("denies every powerful feature except the two the UI uses", () => {
    expect(PERMISSIONS_POLICY).toContain("camera=()");
    expect(PERMISSIONS_POLICY).toContain("microphone=()");
    expect(PERMISSIONS_POLICY).toContain("geolocation=()");
    expect(PERMISSIONS_POLICY).toContain("payment=()");
    expect(PERMISSIONS_POLICY).toContain("usb=()");
    expect(PERMISSIONS_POLICY).toContain("clipboard-write=(self)");
    expect(PERMISSIONS_POLICY).toContain("web-share=(self)");
    expect(PERMISSIONS_POLICY).not.toContain("*");
  });
  it("validates ALLOWED_ORIGINS and HTTPS_ONLY", () => {
    expect(loadSecurityConfig({})).toEqual({ allowedOrigins: [], httpsOnly: false });
    expect(
      loadSecurityConfig({
        ALLOWED_ORIGINS: "https://a.example, http://localhost:5173/",
        HTTPS_ONLY: "1",
        NODE_ENV: "production",
      }),
    ).toEqual({
      allowedOrigins: ["https://a.example", "http://localhost:5173"],
      httpsOnly: true,
    });
    expect(() => loadSecurityConfig({ ALLOWED_ORIGINS: "*" })).toThrow();
    expect(() => loadSecurityConfig({ ALLOWED_ORIGINS: "https://a.example/path" })).toThrow();
    expect(() => loadSecurityConfig({ ALLOWED_ORIGINS: "ftp://a.example" })).toThrow();
  });
  it("checks WebSocket origins against Host and the allow-list", () => {
    expect(isAllowedOrigin(undefined, "a:1", [])).toBe(true); // non-browser client
    expect(isAllowedOrigin("http://a:1", "a:1", [])).toBe(true);
    expect(isAllowedOrigin("https://a:1", "a:1", [])).toBe(true);
    expect(isAllowedOrigin("http://evil.example", "a:1", [])).toBe(false);
    expect(isAllowedOrigin("null", "a:1", [])).toBe(false);
    expect(isAllowedOrigin("http://a:1.evil.example", "a:1", [])).toBe(false);
    expect(isAllowedOrigin("http://other", "a:1", ["http://other"])).toBe(true);
    expect(isAllowedOrigin("http://a:1", undefined, [])).toBe(false);
  });
  it("only ever enables test mode outside production", () => {
    expect(() => isTestModeEnabled({ NODE_ENV: "production", POLY_TEST_MODE: "1" })).toThrow();
    expect(() => isTestModeEnabled({ NODE_ENV: "production" }, true)).toThrow();
    expect(isTestModeEnabled({ NODE_ENV: "production" })).toBe(false);
  });
  it("allow-lists method per API route", () => {
    const rej = (m: string, p: string) => routeRejection(m, p, false)?.status;
    expect(rej("GET", "/api/themes")).toBeUndefined();
    expect(rej("POST", "/api/themes")).toBe(405);
    expect(rej("GET", "/api/ready")).toBeUndefined();
    expect(rej("HEAD", "/api/ready")).toBeUndefined();
    expect(rej("POST", "/api/ready")).toBe(405);
    expect(rej("GET", "/api/live")).toBeUndefined();
    expect(rej("HEAD", "/api/live")).toBeUndefined();
    expect(rej("POST", "/api/live")).toBe(405);
    expect(rej("GET", "/api/live/x")).toBe(404);
    expect(rej("POST", "/api/games")).toBeUndefined();
    expect(rej("GET", "/api/games")).toBe(405);
    expect(rej("GET", "/api/games/abc")).toBeUndefined();
    expect(rej("DELETE", "/api/games/abc")).toBe(405);
    expect(rej("PATCH", "/api/games/abc/settings")).toBeUndefined();
    expect(rej("POST", "/api/games/abc/settings")).toBe(405);
    expect(rej("DELETE", "/api/games/abc/seats/p2")).toBeUndefined();
    expect(rej("GET", "/api/games/abc/seats/p2")).toBe(405);
    expect(rej("PATCH", "/api/games/abc/seats/me")).toBeUndefined();
    expect(rej("POST", "/api/games/abc/seats/me")).toBe(405);
    expect(rej("GET", "/api/games/abc/seats/me")).toBe(405);
    expect(rej("POST", "/api/games/abc/start")).toBeUndefined();
    expect(rej("PATCH", "/api/games/abc/chat")).toBeUndefined();
    expect(rej("GET", "/api/games/abc/chat")).toBe(405);
    expect(rej("POST", "/api/games/abc/chat")).toBe(405);
    expect(rej("GET", "/api/nothing")).toBe(404);
    expect(rej("GET", "/api/games/abc/whatever")).toBe(404);
    expect(rej("GET", "/api/test/state")).toBe(404);
    expect(routeRejection("GET", "/api/test/state", true)).toBeNull();
    expect(rej("GET", "/index.html")).toBeUndefined();
    expect(rej("POST", "/index.html")).toBe(405);
    expect(rej("GET", "/x".padEnd(3000, "x"))).toBe(414);
  });
});

describe("HTTP hardening", () => {
  let srv: RunningServer;
  let dir: string;
  let base: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "poly-hard-"));
    const pub = join(dir, "public");
    mkdirSync(join(pub, "assets"), { recursive: true });
    mkdirSync(join(pub, ".git"), { recursive: true });
    writeFileSync(join(pub, "index.html"), "<h1>index</h1>");
    writeFileSync(join(pub, "version.json"), "{}");
    writeFileSync(join(pub, ".env"), "SECRET=1");
    writeFileSync(join(pub, ".git", "config"), "x");
    writeFileSync(join(pub, "assets", "index-Gvh4ygMT.js"), "1");
    writeFileSync(join(pub, "assets", "inter-latin-700-normal-BS7r-qZs.woff2"), "1");
    writeFileSync(join(pub, "assets", "plain.glb"), "1");
    srv = await startServer({
      port: 0,
      host: "127.0.0.1",
      dataDir: join(dir, "data"),
      botDelayMs: 0,
      staticDir: pub,
      security: { httpsOnly: true, allowedOrigins: ["http://trusted.example"] },
    });
    base = `http://127.0.0.1:${srv.port}`;
  });
  afterAll(async () => {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (path: string, init?: RequestInit) => fetch(base + path, init);

  it("sets the full header set with exact values (HTTPS mode)", async () => {
    const h = (await get("/")).headers;
    expect(h.get("content-security-policy")).toBe(`${CSP}; upgrade-insecure-requests`);
    expect(h.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("referrer-policy")).toBe("no-referrer");
    expect(h.get("permissions-policy")).toBe(PERMISSIONS_POLICY);
    expect(h.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(h.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("x-powered-by")).toBeNull();
    expect(h.get("server")).toBeNull();
  });
  it("sets headers on API and error responses too", async () => {
    for (const path of ["/api/themes", "/api/nope", "/assets/missing.js"]) {
      const h = (await get(path)).headers;
      expect(h.get("content-security-policy"), path).toContain("default-src 'none'");
      expect(h.get("x-content-type-options"), path).toBe("nosniff");
    }
  });
  it("caches hashed assets immutably, everything mutable never", async () => {
    const cc = async (p: string) => (await get(p)).headers.get("cache-control");
    expect(await cc("/assets/index-Gvh4ygMT.js")).toBe("public, max-age=31536000, immutable");
    expect(await cc("/assets/inter-latin-700-normal-BS7r-qZs.woff2")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await cc("/assets/plain.glb")).toBe("no-cache");
    expect(await cc("/")).toBe("no-store");
    expect(await cc("/index.html")).toBe("no-store");
    expect(await cc("/version.json")).toBe("no-store");
    expect(await cc("/api/themes")).toBe("no-store");
    expect(await cc("/api/nope")).toBe("no-store");
  });
  it("omits HSTS and upgrade-insecure-requests unless HTTPS mode is on", async () => {
    const plain = await startServer({
      port: 0,
      host: "127.0.0.1",
      dataDir: join(dir, "data2"),
      staticDir: null,
      security: { httpsOnly: false },
    });
    try {
      const h = (await fetch(`http://127.0.0.1:${plain.port}/api/themes`)).headers;
      expect(h.get("strict-transport-security")).toBeNull();
      expect(h.get("content-security-policy")).toBe(CSP);
    } finally {
      await plain.close();
    }
  });
  it("sends no CORS headers to foreign origins and answers preflights only for allowed ones", async () => {
    const foreign = await get("/api/themes", { headers: { origin: "http://evil.example" } });
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
    const same = await get("/api/themes");
    expect(same.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await get("/api/games", {
      method: "OPTIONS",
      headers: { origin: "http://evil.example", "access-control-request-method": "POST" },
    });
    expect(pre.status).toBe(403);
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
    const ok = await get("/api/games", {
      method: "OPTIONS",
      headers: { origin: "http://trusted.example", "access-control-request-method": "POST" },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://trusted.example");
    expect(ok.headers.get("vary")).toContain("Origin");
    expect(ok.headers.get("access-control-allow-headers")).toBe(
      "content-type, x-player-token, x-pow-solution",
    );
    const real = await get("/api/themes", { headers: { origin: "http://trusted.example" } });
    expect(real.headers.get("access-control-allow-origin")).toBe("http://trusted.example");
    expect(real.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
  });
  it("rejects cross-origin state changes (browser Origin header) with 403", async () => {
    const r = await get("/api/games", {
      method: "POST",
      headers: { origin: "http://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ hostName: "x" }),
    });
    expect(r.status).toBe(403);
  });
  it("answers 405 with Allow, 404 for unknown API paths, 414 for long URLs", async () => {
    const m = await get("/api/themes", { method: "DELETE" });
    expect(m.status).toBe(405);
    expect(m.headers.get("allow")).toBe("GET, HEAD");
    expect((await get("/api/unknown")).status).toBe(404);
    expect((await get("/api/games/abc/whatever")).status).toBe(404);
    expect((await get(`/${"a".repeat(3000)}`)).status).toBe(414);
    expect((await get("/", { method: "POST" })).status).toBe(405);
  });
  it("requires JSON content-type and limits the body", async () => {
    const post = (body: string, type?: string) =>
      get("/api/games", {
        method: "POST",
        headers: type ? { "content-type": type } : {},
        body,
      });
    expect((await post("{}", "text/plain")).status).toBe(415);
    expect((await post("{}", "application/json; charset=utf-8")).status).toBe(400);
    const big = await post(JSON.stringify({ x: "a".repeat(70_000) }), "application/json");
    expect(big.status).toBe(413);
  });
  it("never serves dotfiles or dot directories", async () => {
    const paths = [
      "/.env",
      "/.git/config",
      "/assets/../.env",
      "/assets/..%2f.env",
      "/.well-known/x",
    ];
    for (const p of paths) {
      const r = await get(p);
      expect(r.status, p).toBe(404);
      expect(await r.text(), p).not.toContain("SECRET");
    }
  });
  it("has no test-mode routes and no env switch in production", async () => {
    expect((await get("/api/test/state")).status).toBe(404);
    expect((await get("/api/test/reset", { method: "POST" })).status).toBe(404);
    const prev = { n: process.env["NODE_ENV"], t: process.env["POLY_TEST_MODE"] };
    process.env["NODE_ENV"] = "production";
    process.env["POLY_TEST_MODE"] = "1";
    try {
      await expect(
        startServer({ port: 0, host: "127.0.0.1", dataDir: join(dir, "d3"), staticDir: null }),
      ).rejects.toThrow(/POLY_TEST_MODE/);
    } finally {
      if (prev.n === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = prev.n;
      if (prev.t === undefined) delete process.env["POLY_TEST_MODE"];
      else process.env["POLY_TEST_MODE"] = prev.t;
    }
  });

  describe("WebSocket origin", () => {
    const open = (origin?: string): Promise<"open" | number> =>
      new Promise((ok) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${srv.port}/ws`,
          origin ? { headers: { origin } } : {},
        );
        ws.on("open", () => {
          ws.close();
          ok("open");
        });
        ws.on("unexpected-response", (_req, res) => ok(res.statusCode ?? 0));
        ws.on("error", () => undefined);
      });
    it("accepts same-origin, allow-listed and origin-less clients", async () => {
      expect(await open()).toBe("open");
      expect(await open(`http://127.0.0.1:${srv.port}`)).toBe("open");
      expect(await open("http://trusted.example")).toBe("open");
    });
    it("rejects foreign origins with 403 at upgrade", async () => {
      expect(await open("http://evil.example")).toBe(403);
      expect(await open("null")).toBe(403);
    });
    it("rejects a raw upgrade for the wrong path", async () => {
      const status = await new Promise<number>((ok) => {
        const r = request({
          host: "127.0.0.1",
          port: srv.port,
          path: "/ws2",
          headers: { connection: "Upgrade", upgrade: "websocket" },
        });
        r.on("error", () => ok(0));
        r.on("response", (res) => ok(res.statusCode ?? 0));
        r.on("upgrade", () => ok(101));
        r.end();
      });
      expect(status).not.toBe(101);
    });
  });
});
