// What counts as the "first real request" that lets a fresh instance in on-traffic mode ask the holder to hand over
// (DESIGN #91): everything except the platform's health probes and the readiness/liveness checks of the deploy script.
import { describe, expect, it } from "vitest";
import { countsAsTraffic } from "../src/lease/traffic.ts";

const req = (method: string, url: string, userAgent?: string) => ({
  method,
  url,
  headers: userAgent === undefined ? {} : { "user-agent": userAgent },
});

describe("countsAsTraffic", () => {
  it.each([
    ["GET", "/"],
    ["GET", "/index.html"],
    ["GET", "/api/themes"],
    ["GET", "/api/games/abc"],
    ["POST", "/api/games"],
    ["GET", "/ws"],
    ["GET", "/api/ready/x"],
    ["GET", "/api/readyx"],
  ])("a visitor's %s %s counts", (method, url) => {
    expect(countsAsTraffic(req(method, url, "Mozilla/5.0"))).toBe(true);
    expect(countsAsTraffic(req(method, url))).toBe(true);
  });
  it.each([
    ["GET", "/api/ready"],
    ["HEAD", "/api/ready"],
    ["GET", "/api/ready?x=1"],
    ["GET", "/api/live"],
    ["HEAD", "/api/live"],
  ])("the readiness and liveness checks (%s %s) never count", (method, url) => {
    expect(countsAsTraffic(req(method, url, "curl/8.7.1"))).toBe(false);
  });
  it("platform health probes never count, whatever they ask for", () => {
    expect(countsAsTraffic(req("GET", "/api/themes", "kube-probe/1.31"))).toBe(false);
    expect(countsAsTraffic(req("GET", "/", "kube-probe/1.29+"))).toBe(false);
    expect(countsAsTraffic(req("GET", "/", "Mozilla/5.0 kube-probe/1.31"))).toBe(true);
  });
});
