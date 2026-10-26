// The dev proxy must keep the browser's Host header, otherwise the server's same-origin check refuses every POST
// made through `npm run dev` / `npm run aspire` (Origin localhost:5173 vs rewritten Host localhost:8787).
import { describe, expect, it } from "vitest";
import { devProxy } from "../src/dev-proxy.ts";

describe("dev proxy", () => {
  it.each(["/api", "/ws"] as const)("keeps the Host header for %s", (path) => {
    const entry = devProxy("http://localhost:8787")[path];
    expect(entry.target).toBe("http://localhost:8787");
    expect(entry.changeOrigin).toBe(false);
  });

  it("proxies WebSocket upgrades on /ws", () => {
    expect(devProxy("http://localhost:8787")["/ws"].ws).toBe(true);
  });
});
