// `npm run security` — network-dependent security verification, run it before every deploy (docs/DESIGN.md #42).
//   npm run security            everything (docker steps are skipped with a notice when docker is unavailable)
//   npm run security -- --fast  skip the slow steps (image build + trivy image scan, semgrep)
// Offline-capable checks (eslint-plugin-security / no-unsanitized, hardening tests) are part of `npm run check`.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fast = process.argv.includes("--fast");
const IMAGE = "hochstapler:security-scan";

const docker = (image, args, { mounts = [], extra = [] } = {}) => ({
  cmd: "docker",
  args: ["run", "--rm", ...mounts.flatMap((m) => ["-v", m]), ...extra, image, ...args],
});
const ro = (rel, to = `/repo/${rel}`) => `${resolve(root, rel)}:${to}:ro`;

const dockerOk = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

/** @type {{ name: string, docker?: boolean, slow?: boolean, run: () => { cmd: string, args: string[] }, stdin?: string }[]} */
const steps = [
  {
    name: "npm audit (production dependencies, fails on high+)",
    run: () => ({ cmd: "npm", args: ["audit", "--audit-level=high", "--omit=dev"] }),
  },
  {
    name: "npm audit (all dependencies incl. dev, fails on moderate+)",
    run: () => ({ cmd: "npm", args: ["audit", "--audit-level=moderate"] }),
  },
  {
    name: "npm audit (apphost: local Aspire AppHost, own lockfile, fails on moderate+)",
    run: () => ({ cmd: "npm", args: ["audit", "--prefix", "apphost", "--audit-level=moderate"] }),
  },
  {
    name: "lockfile-lint (https registry.npmjs.org only, integrity required)",
    run: () => ({
      cmd: "npx",
      args: [
        "lockfile-lint",
        "--path",
        "package-lock.json",
        "apphost/package-lock.json",
        "--type",
        "npm",
        "--allowed-hosts",
        "npm",
        "--validate-https",
        "--validate-integrity",
      ],
    }),
  },
  {
    // what was ever committed — the scan that matters for leaks (the working-tree scan below also
    // catches things before they are committed)
    name: "gitleaks (secrets in the git history)",
    docker: true,
    run: () =>
      docker(
        "ghcr.io/gitleaks/gitleaks:latest",
        ["git", "/repo", "--no-banner", "--redact", "-c", "/repo/.gitleaks.toml"],
        { mounts: [`${root}:/repo:ro`] },
      ),
  },
  {
    name: "gitleaks (secrets in the working tree)",
    docker: true,
    run: () =>
      docker(
        "ghcr.io/gitleaks/gitleaks:latest",
        ["dir", "/repo", "--no-banner", "--redact", "-c", "/repo/.gitleaks.toml"],
        { mounts: [`${root}:/repo:ro`] },
      ),
  },
  {
    name: "osv-scanner (package-lock.json against OSV)",
    docker: true,
    run: () =>
      docker("ghcr.io/google/osv-scanner:latest", ["--lockfile=/repo/package-lock.json"], {
        mounts: [ro("package-lock.json")],
      }),
  },
  {
    name: "hadolint (Dockerfile)",
    docker: true,
    run: () => ({
      cmd: "docker",
      args: ["run", "--rm", "-i", "hadolint/hadolint"],
    }),
    stdin: "Dockerfile",
  },
  {
    name: "trivy config (Dockerfile misconfiguration)",
    docker: true,
    run: () =>
      docker(
        "aquasec/trivy:latest",
        [
          "config",
          "--quiet",
          "--exit-code",
          "1",
          "--skip-dirs",
          "/repo/node_modules",
          "--skip-dirs",
          "/repo/.claude",
          "--skip-dirs",
          "/repo/packages",
          "/repo",
        ],
        { mounts: [`${root}:/repo:ro`] },
      ),
  },
  {
    name: "caddy validate (deploy/Caddyfile)",
    docker: true,
    run: () =>
      docker("caddy:2-alpine", ["caddy", "validate", "--config", "/etc/caddy/Caddyfile"], {
        mounts: [ro("deploy/Caddyfile", "/etc/caddy/Caddyfile")],
        extra: ["-e", "DOMAIN=example.com"],
      }),
  },
  {
    name: "docker build + trivy image scan (HIGH/CRITICAL with a fix)",
    docker: true,
    slow: true,
    run: () => ({
      cmd: "sh",
      args: [
        "-c",
        `docker build -q -t ${IMAGE} . >/dev/null && docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image --quiet --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed ${IMAGE}`,
      ],
    }),
  },
  {
    name: "semgrep (p/typescript p/nodejs p/secrets)",
    docker: true,
    slow: true,
    // mount only source directories: a git worktree's .git file confuses semgrep inside the container
    run: () =>
      docker(
        "semgrep/semgrep",
        [
          "semgrep",
          "scan",
          "--config",
          "p/typescript",
          "--config",
          "p/nodejs",
          "--config",
          "p/secrets",
          "--metrics=off",
          "--error",
          "--quiet",
          "--exclude",
          "node_modules",
          "--exclude",
          "dist",
          "--exclude",
          "raw",
        ],
        {
          mounts: ["packages", "e2e", "scripts", "deploy", "Dockerfile", "compose.yaml"]
            .filter((p) => existsSync(resolve(root, p)))
            .map((p) => ro(p, `/src/${p}`)),
        },
      ),
  },
];

const results = [];
for (const step of steps) {
  if (step.docker && !dockerOk) {
    console.log(
      `\n--- SKIP ${step.name}: docker is not available (install/start Docker to run it)`,
    );
    results.push({ name: step.name, status: "SKIP" });
    continue;
  }
  if (step.slow && fast) {
    console.log(`\n--- SKIP ${step.name}: --fast`);
    results.push({ name: step.name, status: "SKIP" });
    continue;
  }
  console.log(`\n=== ${step.name}`);
  const { cmd, args } = step.run();
  const stdinFd = step.stdin ? openSync(resolve(root, step.stdin), "r") : null;
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: [stdinFd ?? "inherit", "inherit", "inherit"],
  });
  if (stdinFd !== null) {
    closeSync(stdinFd);
  }
  results.push({ name: step.name, status: r.status === 0 ? "PASS" : "FAIL" });
}

console.log("\nSecurity summary");
for (const r of results) {
  console.log(`  ${r.status.padEnd(4)}  ${r.name}`);
}
const failed = results.filter((r) => r.status === "FAIL");
if (failed.length > 0) {
  console.error(`\n${failed.length} security check(s) FAILED.`);
  process.exit(1);
}
