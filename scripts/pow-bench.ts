// Measures how long the game-creation proof of work takes in a real Chromium, with and without CPU throttling
// (docs/DESIGN.md #70). It starts the real server with the given difficulty, fetches challenges and solves them in the
// built worker (`npm run build -w @poly/client` first).
//   npx tsx scripts/pow-bench.ts [difficulty=100000] [runs=30] [rates=1,4,6]
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { buildSync } from "esbuild";
import { startServer } from "../packages/server/src/server.ts";

const difficulty = Number(process.argv[2] ?? 100_000);
const runs = Number(process.argv[3] ?? 30);
const rates = (process.argv[4] ?? "1,4,6").split(",").map(Number);
const staticDir = resolve(import.meta.dirname, "../packages/client/dist");
const worker = readdirSync(join(staticDir, "assets")).find((f) => /^pow\.worker-.*\.js$/.test(f));
if (!worker) {
  throw new Error("pow.worker-*.js missing: run `npm run build -w @poly/client` first");
}

const dataDir = mkdtempSync(join(tmpdir(), "hochstapler-pow-"));
const server = await startServer({
  port: 0,
  host: "127.0.0.1",
  dataDir,
  staticDir,
  pow: { difficulty, capacity: 100_000 },
  limits: { powBurst: 1e9, powPerHour: 1e9 },
});
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.port}/`);
const cdp = await page.context().newCDPSession(page);

// CDP throttling slows the page's main thread but not dedicated workers, so the shipped worker is measured as is and the
// same solver is additionally run on the main thread, where throttling does apply (a slow-phone estimate).
const solverBundle = buildSync({
  entryPoints: [resolve(import.meta.dirname, "../packages/engine/src/pow.ts")],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "PowSolver",
  platform: "browser",
}).outputFiles[0]?.text;
if (!solverBundle) {
  throw new Error("solver bundle failed");
}
await page.evaluate(`${solverBundle}; window.PowSolver = PowSolver;`);

const median = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const pct = (xs: number[], p: number): number =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;

console.log(
  `difficulty ${difficulty}, ${runs} runs per setting, cores ${await page.evaluate(() => navigator.hardwareConcurrency)}`,
);
for (const rate of rates) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  const times = await page.evaluate(
    async ({ url, n }) => {
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const res = await fetch("/api/pow/challenge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "create-game" }),
        });
        const { challenge } = (await res.json()) as { challenge: unknown };
        const start = performance.now();
        await new Promise<void>((done, fail) => {
          const w = new Worker(url, { type: "module" });
          w.onmessage = () => {
            w.terminate();
            done();
          };
          w.onerror = () => fail(new Error("worker failed"));
          w.postMessage({ challenge });
        });
        out.push(performance.now() - start);
      }
      return out;
    },
    { url: `/assets/${worker}`, n: runs },
  );
  const line = (label: string, xs: number[]): void =>
    console.log(
      `throttle ${rate}x ${label}: median ${median(xs).toFixed(0)} ms, p90 ${pct(xs, 0.9).toFixed(0)} ms, max ${Math.max(...xs).toFixed(0)} ms`,
    );
  line("worker (shipped)", times);
  const mainThread = await page.evaluate(async (n) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const res = await fetch("/api/pow/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create-game" }),
      });
      const { challenge } = (await res.json()) as { challenge: unknown };
      const start = performance.now();
      await (
        window as unknown as { PowSolver: { solvePow(c: unknown): Promise<unknown> } }
      ).PowSolver.solvePow(challenge);
      out.push(performance.now() - start);
    }
    return out;
  }, runs);
  line("main thread   ", mainThread);
}
await browser.close();
await server.close();
rmSync(dataDir, { recursive: true, force: true });
