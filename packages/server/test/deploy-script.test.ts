// scripts/azure-deploy.sh against a fake Azure CLI (test/fixtures/fake-azure): the blue/green order of the writer-lease
// rollout (DESIGN #89), the one-time stop-first migration, the fallback and the single-revision guarantee at the end.
// Nothing here talks to Azure.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../../..");
const fakes = resolve(import.meta.dirname, "fixtures/fake-azure");
const SCRIPT = process.env["DEPLOY_SCRIPT_UNDER_TEST"] ?? join(repo, "scripts/azure-deploy.sh");
const OLD_IMAGE = "crfake.azurecr.io/hochstapler:old";

interface Run {
  status: number | null;
  out: string;
  err: string;
  calls: string[];
  revisions: string[];
}

describe("scripts/azure-deploy.sh (fake az)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "poly-deploy-"));
    // a copy of the script outside the repo: no .env.azure of the developer is picked up
    mkdirSync(join(dir, "repo/scripts"), { recursive: true });
    copyFileSync(SCRIPT, join(dir, "repo/scripts/azure-deploy.sh"));
    mkdirSync(join(dir, "bin"));
    for (const f of readdirSync(fakes)) {
      copyFileSync(join(fakes, f), join(dir, "bin", f));
      chmodSync(join(dir, "bin", f), 0o755);
    }
    mkdirSync(join(dir, "state"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (revisions: string[], args: string[], env: Record<string, string> = {}): Run => {
    writeFileSync(join(dir, "state/revisions"), revisions.map((r) => `${r}\n`).join(""));
    const r = spawnSync("bash", [join(dir, "repo/scripts/azure-deploy.sh"), "--yes", ...args], {
      encoding: "utf8",
      timeout: 60_000,
      env: {
        PATH: `${join(dir, "bin")}:/usr/bin:/bin`,
        HOME: dir,
        AZ_SUBSCRIPTION: "00000000-0000-0000-0000-000000000000",
        DEPLOY_TAG: "new",
        FAKE_AZ_STATE: join(dir, "state"),
        HANDOVER_TIMEOUT_SEC: "3",
        ...env,
      },
    });
    const read = (f: string) =>
      readFileSync(join(dir, "state", f), "utf8")
        .split("\n")
        .filter(Boolean);
    return {
      status: r.status,
      out: r.stdout,
      err: r.stderr,
      calls: read("calls.log"),
      revisions: read("revisions"),
    };
  };
  const index = (calls: string[], pattern: RegExp): number =>
    calls.findIndex((c) => pattern.test(c));

  it("blue/green: new revision with 0 % traffic, ready = holds the lease, traffic shift, then the old one stops", () => {
    const r = run([`app--r1 true ${OLD_IMAGE} azure-blob`], ["--skip-build"]);
    expect(r.err).not.toMatch(/ERROR/);
    expect(r.status).toBe(0);
    const rollout = index(r.calls, /deployApp=true .*trafficRevision=app--r1/);
    const ready = index(r.calls, /curl https:\/\/app--r2\.fake\.test\/api\/ready/);
    const shift = index(r.calls, /ingress traffic set .*--revision-weight app--r2=100/);
    const stop = index(r.calls, /revision deactivate .*--revision app--r1/);
    expect(rollout).toBeGreaterThan(-1);
    expect(ready).toBeGreaterThan(rollout);
    expect(shift).toBeGreaterThan(ready);
    expect(stop).toBeGreaterThan(shift);
    // nothing was stopped before the new revision existed
    expect(index(r.calls, /revision deactivate/)).toBe(stop);
    expect(r.revisions.filter((l) => l.includes(" true "))).toEqual([
      expect.stringMatching(/^app--r2 true/),
    ]);
    expect(r.out).toContain("handover: blue-green");
    expect(r.out).toMatch(/Active revisions: app--r2 \/ total replicas: 1/);
  });

  it("a running revision without the writer lease is stopped first (one-time migration)", () => {
    const r = run([`app--r1 true ${OLD_IMAGE}`], ["--skip-build"]);
    expect(r.status).toBe(0);
    const stop = index(r.calls, /revision deactivate .*--revision app--r1/);
    const rollout = index(r.calls, /deployApp=true/);
    expect(stop).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(rollout);
    expect(r.calls[rollout]).not.toContain("trafficRevision");
    expect(r.out).toContain("one-time migration");
  });

  it("falls back to stopping the old revision when the new one does not become ready, and says so", () => {
    const r = run([`app--r1 true ${OLD_IMAGE} azure-blob`], ["--skip-build"], {
      FAKE_READY: "alone",
    });
    expect(r.status).toBe(0);
    expect(r.err).toContain("falling back");
    const stop = index(r.calls, /revision deactivate .*--revision app--r1/);
    const shift = index(r.calls, /ingress traffic set .*app--r2=100/);
    expect(stop).toBeLessThan(shift);
    expect(r.out).toContain("handover: fallback");
    expect(r.revisions.filter((l) => l.includes(" true "))).toHaveLength(1);
  });

  it("--infra-only with an unchanged template keeps the running revision and stops nothing", () => {
    const r = run([`app--r1 true ${OLD_IMAGE} azure-blob`], ["--infra-only"]);
    expect(r.status).toBe(0);
    expect(index(r.calls, /revision deactivate/)).toBe(-1);
    expect(r.out).toContain("No other revision to hand over from");
    expect(r.revisions).toEqual([`app--r1 true ${OLD_IMAGE} azure-blob`]);
  });

  it("runs with errexit, nounset and pipefail and stays valid bash", () => {
    const text = readFileSync(SCRIPT, "utf8");
    expect(text).toMatch(/^set -euo pipefail$/m);
    expect(spawnSync("bash", ["-n", SCRIPT]).status).toBe(0);
  });
});
