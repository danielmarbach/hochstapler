// scripts/azure-deploy.sh against a fake Azure CLI and curl (test/fixtures/fake-azure): the traffic-first blue/green order
// of the writer-lease rollout (DESIGN #89, #91), the one-time stop-first migration, the rollback, the hard fallback and the
// single-revision guarantee at the end.
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
        STANDBY_TIMEOUT_SEC: "3",
        ROLLBACK_WAIT_SEC: "3",
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

  it("blue/green, traffic first (DESIGN #91): standby check, traffic shift, explicit trigger, ready, then the old one stops", () => {
    const r = run([`app--r1 true ${OLD_IMAGE} azure-blob`], ["--skip-build"]);
    expect(r.err).not.toMatch(/ERROR/);
    expect(r.status).toBe(0);
    const rollout = index(r.calls, /deployApp=true .*trafficRevision=app--r1/);
    const running = index(r.calls, /revision show .*--revision app--r2 .*runningState/);
    const replica = index(r.calls, /replica list .*--revision app--r2 .*ready/);
    const live = index(r.calls, /curl https:\/\/app--r2\.fake\.test\/api\/live$/);
    const shift = index(r.calls, /ingress traffic set .*--revision-weight app--r2=100/);
    const trigger = index(r.calls, /curl https:\/\/app--r2\.fake\.test\/$/);
    const ready = index(r.calls, /curl https:\/\/app--r2\.fake\.test\/api\/ready$/);
    const stop = index(r.calls, /revision deactivate .*--revision app--r1/);
    expect(rollout).toBeGreaterThan(-1);
    expect(running).toBeGreaterThan(rollout);
    expect(replica).toBeGreaterThan(rollout);
    expect(live).toBeGreaterThan(Math.max(running, replica));
    expect(shift).toBeGreaterThan(live);
    expect(trigger).toBeGreaterThan(shift);
    expect(ready).toBeGreaterThan(trigger);
    expect(stop).toBeGreaterThan(ready);
    // the standby check must not be a request that starts the handover before the traffic is there
    expect(index(r.calls, /curl https:\/\/app--r2\.fake\.test\/api\/themes/)).toBe(-1);
    expect(
      r.calls.slice(0, shift).filter((c) => /curl https:\/\/app--r2\.fake\.test\/$/.test(c)),
    ).toEqual([]);
    // nothing was stopped before the new revision held the lease, and the old one is stopped last
    expect(index(r.calls, /revision deactivate/)).toBe(stop);
    expect(r.revisions.filter((l) => l.includes(" true "))).toEqual([
      expect.stringMatching(/^app--r2 true/),
    ]);
    expect(r.out).toMatch(/handover took \d+ s/);
    expect(r.out).toContain("handover: blue-green");
    expect(r.out).toMatch(/Active revisions: app--r2 \/ total replicas: 1/);
  });

  it("a new revision that never comes up in standby is removed again; the traffic never moved", () => {
    const r = run([`app--r1 true ${OLD_IMAGE} azure-blob`], ["--skip-build"], {
      FAKE_LIVE: "never",
    });
    expect(r.status).not.toBe(0);
    expect(r.err).toContain("rollout failed, previous revision kept");
    expect(index(r.calls, /ingress traffic set/)).toBe(-1);
    expect(index(r.calls, /revision deactivate .*--revision app--r1/)).toBe(-1);
    expect(index(r.calls, /revision deactivate .*--revision app--r2/)).toBeGreaterThan(-1);
    expect(r.revisions.filter((l) => l.includes(" true "))).toEqual([
      expect.stringMatching(/^app--r1 true/),
    ]);
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

  it("rolls back when the new revision does not take over but the old one is ready: traffic back, new one off, exit non-zero", () => {
    const r = run([`app--r1 true ${OLD_IMAGE} azure-blob`], ["--skip-build"], {
      FAKE_HANDOVER: "stuck",
    });
    expect(r.status).not.toBe(0);
    expect(r.err).toContain("rollout failed, previous revision kept");
    const forward = index(r.calls, /ingress traffic set .*app--r2=100/);
    const back = index(r.calls, /ingress traffic set .*app--r1=100/);
    const stopNew = index(r.calls, /revision deactivate .*--revision app--r2/);
    expect(forward).toBeGreaterThan(-1);
    expect(back).toBeGreaterThan(forward);
    expect(stopNew).toBeGreaterThan(back);
    expect(index(r.calls, /revision deactivate .*--revision app--r1/)).toBe(-1);
    expect(r.revisions.filter((l) => l.includes(" true "))).toEqual([
      expect.stringMatching(/^app--r1 true/),
    ]);
    expect(r.out).not.toContain("handover: fallback");
  });

  it("falls back to stopping the old revision when neither the new nor the old one is ready, and says so", () => {
    const r = run([`app--r1 true ${OLD_IMAGE} azure-blob`], ["--skip-build"], {
      FAKE_HANDOVER: "stuck",
      FAKE_OLD_READY: "never",
    });
    expect(r.status).toBe(0);
    expect(r.err).toContain("falling back");
    const shift = index(r.calls, /ingress traffic set .*app--r2=100/);
    const stop = index(r.calls, /revision deactivate .*--revision app--r1/);
    expect(shift).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(shift);
    expect(index(r.calls, /ingress traffic set .*app--r1=100/)).toBe(-1);
    expect(r.out).toContain("handover: fallback");
    expect(r.revisions.filter((l) => l.includes(" true "))).toEqual([
      expect.stringMatching(/^app--r2 true/),
    ]);
  });

  it("--infra-only with an unchanged template keeps the running revision and stops nothing", () => {
    const r = run([`app--r1 true ${OLD_IMAGE} azure-blob`], ["--infra-only"]);
    expect(r.status).toBe(0);
    expect(index(r.calls, /revision deactivate/)).toBe(-1);
    expect(r.out).toContain("No other revision to hand over from");
    expect(r.revisions).toEqual([`app--r1 true ${OLD_IMAGE} azure-blob`]);
  });

  // DESIGN #92: the share is mounted with the environment's managed identity; shared-key access goes off only once no
  // active revision still mounts the share through the old key-based storage definition.
  const KEY_MOUNT = "hochstapler-data";
  const MI_MOUNT = "hochstapler-data-mi";
  const deployments = (calls: string[]) => calls.filter((c) => /deployment group create/.test(c));

  it("key removal stage 1: while an active revision mounts with the key, every deployment keeps shared-key access on", () => {
    writeFileSync(join(dir, "state/envstorages"), `${KEY_MOUNT}\n`);
    const r = run([`app--r1 true ${OLD_IMAGE} azure-blob ${KEY_MOUNT}`], ["--skip-build"]);
    expect(r.err).not.toMatch(/ERROR/);
    expect(r.status).toBe(0);
    const deploys = deployments(r.calls);
    expect(deploys.length).toBeGreaterThan(1);
    for (const d of deploys) expect(d).toContain("allowSharedKeyAccess=true");
    // blue/green as always: the new revision (managed-identity mount) takes over, then the old one stops
    expect(r.revisions.filter((l) => l.includes(" true "))).toEqual([
      expect.stringMatching(new RegExp(`^app--r2 true .* ${MI_MOUNT}$`)),
    ]);
    // the old storage definition stays until stage 2 (the old revision may still be reactivated)
    expect(index(r.calls, /containerapp env storage remove/)).toBe(-1);
    expect(r.out).toContain("shared-key removal: stage 1");
    expect(r.out).toMatch(/run the script again/i);
  });

  it("key removal stage 2: no active key mount -> shared-key access off, then the old storage definition is removed", () => {
    writeFileSync(join(dir, "state/envstorages"), `${KEY_MOUNT}\n${MI_MOUNT}\n`);
    const r = run([`app--r1 true ${OLD_IMAGE} azure-blob ${MI_MOUNT}`], ["--skip-build"]);
    expect(r.err).not.toMatch(/ERROR/);
    expect(r.status).toBe(0);
    const deploys = deployments(r.calls);
    expect(deploys.length).toBeGreaterThan(0);
    for (const d of deploys) expect(d).toContain("allowSharedKeyAccess=false");
    const remove = index(
      r.calls,
      new RegExp(`containerapp env storage remove .*--storage-name ${KEY_MOUNT}( |$)`),
    );
    expect(remove).toBeGreaterThan(index(r.calls, /deployApp=true/));
    expect(readFileSync(join(dir, "state/envstorages"), "utf8").trim()).toBe(MI_MOUNT);
  });

  it("removes nothing when the old storage definition is already gone", () => {
    writeFileSync(join(dir, "state/envstorages"), `${MI_MOUNT}\n`);
    const r = run([`app--r1 true ${OLD_IMAGE} azure-blob ${MI_MOUNT}`], ["--skip-build"]);
    expect(r.status).toBe(0);
    expect(index(r.calls, /containerapp env storage remove/)).toBe(-1);
  });

  it("AZ_ALLOW_SHARED_KEY=1 keeps shared-key access on (rollback lever) and removes nothing", () => {
    writeFileSync(join(dir, "state/envstorages"), `${KEY_MOUNT}\n${MI_MOUNT}\n`);
    const r = run([`app--r1 true ${OLD_IMAGE} azure-blob ${MI_MOUNT}`], ["--skip-build"], {
      AZ_ALLOW_SHARED_KEY: "1",
    });
    expect(r.status).toBe(0);
    for (const d of deployments(r.calls)) expect(d).toContain("allowSharedKeyAccess=true");
    expect(index(r.calls, /containerapp env storage remove/)).toBe(-1);
  });

  it("never handles a storage key or connection string", () => {
    const text = readFileSync(SCRIPT, "utf8");
    expect(text).not.toMatch(/account-key|connection-string|keys list|listKeys|--sas-token/);
  });

  it("runs with errexit, nounset and pipefail and stays valid bash", () => {
    const text = readFileSync(SCRIPT, "utf8");
    expect(text).toMatch(/^set -euo pipefail$/m);
    expect(spawnSync("bash", ["-n", SCRIPT]).status).toBe(0);
  });
});
