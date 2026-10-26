// Security headers + CSP (docs/DESIGN.md #46): the real, non-lite client must run without a single CSP violation on
// home, lobby (copy link) and a running game that renders GLB models (house, hotel, landmarks).
import type { Page } from "@playwright/test";
import { expect, test } from "../support/responsive.ts";

/** collects `securitypolicyviolation` events and CSP console errors of a page */
async function watchCsp(page: Page): Promise<string[]> {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /content security policy|refused to/i.test(m.text())) {
      violations.push(m.text());
    }
  });
  page.on("pageerror", (e) => violations.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => {
    // the responsive fixtures switch the lite renderer on; this suite wants the real pipeline (shadows, bloom)
    try {
      localStorage.removeItem("poly:lite");
    } catch {
      // about:blank has no storage
    }
    document.addEventListener("securitypolicyviolation", (e) => {
      const w = window as unknown as { __csp?: string[] };
      (w.__csp ??= []).push(
        `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber} ${e.sample}`,
      );
    });
  });
  return violations;
}
const pageViolations = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);

test.describe("CSP and security headers", () => {
  test("index.html and API serve the headers", async ({ request, baseURL }) => {
    for (const path of ["/", "/api/themes"]) {
      const res = await request.get(`${baseURL}${path}`);
      const h = res.headers();
      expect(h["content-security-policy"], path).toContain("default-src 'none'");
      expect(h["content-security-policy"], path).not.toContain("unsafe-");
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["cache-control"]).toBe("no-store");
    }
  });

  test("Start page, lobby and game with GLB models run without CSP violations", async ({
    page,
    table,
  }) => {
    const violations = await watchCsp(page);
    const glbs: string[] = [];
    page.on("response", (r) => {
      if (r.url().endsWith(".glb") && r.ok()) {
        glbs.push(r.url());
      }
    });

    const host = await table.createLobby(["easy"]);
    await table.openAs(host, "start-game");
    await page.getByTestId("copy-invite").click();

    await table.api.start(host);
    await page.reload();
    await page.getByTestId("hud").waitFor();
    await table.setProperties(["Weggisgasse", "Pilatusstrasse"], {
      owner: table.playerId("Anna"),
      level: 5,
    });
    await expect.poll(() => glbs.length, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);

    await page.goto("/#/");
    await expect(page.getByTestId("create-game")).toBeVisible();

    expect(await pageViolations(page)).toEqual([]);
    expect(violations).toEqual([]);
  });

  test("creating a game solves the proof of work in a same-origin worker, without CSP violations", async ({
    page,
    baseURL,
  }) => {
    const violations = await watchCsp(page);
    const scripts: string[] = [];
    const workers: string[] = [];
    page.on("worker", (w) => workers.push(w.url()));
    page.on("response", (r) => {
      if (r.request().resourceType() === "script") {
        scripts.push(r.url());
      }
    });
    const challenges: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/pow/challenge")) {
        challenges.push(r.method());
      }
    });

    await page.goto("/#/");
    await page.getByRole("textbox", { name: "Dein Name" }).fill("Anna");
    await page.getByTestId("create-game").click();
    await expect(page.getByTestId("start-game")).toBeVisible();

    // the worker is a real file served by our own server, not a blob: or data: URL
    expect(challenges).toEqual(["POST"]);
    expect(workers.length).toBeGreaterThan(0);
    for (const url of workers) {
      expect(url).toMatch(new RegExp(`^${baseURL}/assets/pow\\.worker-[A-Za-z0-9_-]{8}\\.js$`));
    }
    expect(scripts.some((u) => u.includes("/assets/pow.worker-"))).toBe(true);
    const res = await page.request.get(workers[0] ?? "");
    expect(res.ok()).toBe(true);
    expect(res.headers()["content-type"]).toMatch(/javascript/);

    expect(await pageViolations(page)).toEqual([]);
    expect(violations).toEqual([]);
  });
});
