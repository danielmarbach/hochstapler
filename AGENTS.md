# AGENTS.md — Hochstapler (private property-trading board game)

Single source of project rules for all coding agents (Codex, Claude Code via `CLAUDE.md` -> `@AGENTS.md`, others).

## Project overview

- 3D property-trading board game for the browser. TypeScript monorepo (npm workspaces): `packages/engine` (pure rules, bots, themes, zod
  schemas; runs on server and client), `packages/server` (Node 25, `node:http` + `ws` + `node:sqlite`, authoritative),
  `packages/client` (Vite + Three.js + Preact), `e2e/` (Playwright-BDD, English Gherkin), `deploy/` (Caddy, prod compose).
- **`docs/DESIGN.md` is the decision log** (numbered, append-only, English; rows written before the language switch were translated from German). Read it before changing behaviour; append a new
  row at the end of the log table for every design/security/architecture decision. Never delete rows, mark "ersetzt durch #NN".
- `README.md` (English) documents running, hosting and testing. Keep it in sync with scripts and env vars.

## Workflow rules

- **Strict red/green**: write the failing test first, see it fail for the right reason, then implement. Bug fix = regression test first.
- Test pyramid (DESIGN #23/#24): engine unit + property tests (fast-check) at the base, server tests (REST/WS) in the middle,
  browser scenarios (`e2e/features/*.feature`, plus `e2e/responsive` and `e2e/security`) at the top. Prefer the lowest level that can prove it.
- Before finishing: `npm run typecheck && npm run lint && npm run format:check && npm test` (= `npm run check`), plus
  `npm run test:e2e` when UI/server/headers change (`E2E_PORT=<free port>` if 8788 is taken).
- Lint is strict (`--max-warnings 0`, typescript-code-review skill in `.claude/skills/`): no `any`, no `!`, no enums, no
  `JSON.parse(...) as T` (use zod), `curly`, `eqeqeq`, exhaustive switches. Do not blanket-disable rules; a justified
  single-line `eslint-disable-next-line <rule> -- <reason>` is the only accepted form. Prettier formats (`npm run format`).
- i18n: UI/engine texts exist in `de` (source), `en` and `gsw` (Luzernerdeutsch, never auto-picked). Every new user-visible
  string needs all three (`packages/client/src/i18n`, `packages/engine/src/i18n`); never hardcode text in components.
- Commits: small, imperative message; do not commit `.env*`, `data/`, `*.sqlite`.

## Choosing libraries (DESIGN #68)

- **Prefer a proven library over hand-written code.** Hand-written is allowed only for trivial logic and needs a one-line
  justification in the DESIGN.md row ("why not a library").
- **Every new dependency is evaluated before it is added**, with evidence (`npm view <pkg> ...`, `gh api repos/<owner>/<repo>`
  plus `/contributors`, `/releases`, `/actions/workflows`, closed `/issues` for response and patch speed, `npm pack` + grep of the
  tarball) against the criteria of <https://www.planetgeek.ch/2010/06/20/how-to-select-open-source-libraries/>: license;
  activity in the last 6 months; unit tests; documentation; extension points / no forced framework; builds from source; CI;
  roadmap; issue tracker; patch speed; response time; community sentiment; number of active contributors; versioning concept;
  curated changes. Plus the npm supply-chain criteria: transitive dependency count, no install scripts, npm provenance /
  OpenSSF Scorecard where available, TypeScript types, ESM, no `eval` / `new Function` / `innerHTML`, no CSP loosening.
- **Record a compact evaluation table per package in the DESIGN.md row** (accepted and rejected candidates, with the reason for a
  rejection). A candidate that fails a hard criterion (license, inactive, single maintainer without tests, CSP break) is rejected.
- Install with `--ignore-scripts`, commit the lockfile, then run `npm audit --omit=dev` and lockfile-lint.

## Security rules (DESIGN #46) — do not regress

Principle: **deny by default, allow only what the game really needs.** Every loosening needs a DESIGN.md row and a test.

- **Headers/CSP** live in `packages/server/src/security.ts` and stay restrictive: no `unsafe-inline`, no `unsafe-eval`, no
  wildcard sources, no third-party hosts (fonts/models/scripts are self-hosted; the e2e suite blocks external requests).
  When a feature needs a new source, add the narrowest directive, update `hardening.test.ts` (exact values) AND
  `deploy/Caddyfile` (`deploy.test.ts` checks both agree), and prove no CSP violation in `e2e/security/csp.spec.ts`.
- **New endpoints**: add the route + methods to `API_ROUTES` in `security.ts` (405/404 otherwise), validate every
  input with zod (body, params, headers), enforce auth (`x-player-token` -> seat, host-only where needed), keep JSON-only
  bodies and the 64 KB limit, and add tests (happy path, wrong method, bad input, missing/foreign token).
- **CORS stays off** (same-origin). Extra origins only via `ALLOWED_ORIGINS`. WebSocket upgrades check `Origin` vs `Host`.
- **Secrets and tokens**: never in URLs, query strings, logs, error messages or analytics. Player tokens travel in the
  `x-player-token` header or WS `hello`; the only URL carrier is the **fragment** (`#/...`, never sent to servers). Store
  only hashes server-side (`sha256`, compare with `safeEqualHex`). No secrets in the repo (`.env*` is ignored, gitleaks runs).
- **Telemetry** (OpenTelemetry, DESIGN #54-#56): manual instrumentation via `@opentelemetry/api` only; the SDK loads solely
  when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. **Never put tokens, invite codes, player names, IP addresses, raw URLs/query
  strings or user agents into span/metric attributes** (game id, action type, seat index and route *templates* are fine).
  No auto-instrumentation, no browser telemetry (CSP unchanged). New telemetry needs a test in `telemetry.test.ts`.
- **Test mode** (`POLY_TEST_MODE`, `/api/test/*`) exists only in tests/e2e; the server must refuse to start with it in
  production and the routes must 404 there (regression tests in `hardening.test.ts`). Never expose or document it for prod.
- **DOM sinks**: no `innerHTML`/`dangerouslySetInnerHTML`/`eval`/`new Function`; `eslint-plugin-no-unsanitized` enforces it.
  zod runs jitless on the client (`zod-config.ts`) because of the CSP.
- **Static files** only from `packages/client/dist` (realpath-checked, no dotfiles); never serve repo or data directories.
- **Dependencies**: prefer none; pin via lockfile, `npm ci`; only https `registry.npmjs.org` (lockfile-lint); no install scripts
  needed (`--ignore-scripts`). Fix `npm audit` findings (upgrade) instead of ignoring them.
- **Before every deploy run `npm run security`** (audit, lockfile-lint, gitleaks, osv-scanner, hadolint, trivy, caddy validate,
  semgrep; needs network, Docker steps skip without Docker). `npm run lint` carries the offline security lint.

## Azure Container Apps (DESIGN #50-#52, writer lease #89)

- `infra/main.bicep` + `scripts/azure-deploy.sh` (`npm run deploy:azure`) are the only way to deploy; `az bicep build` must stay warning-free.
- **Never open the database without holding the writer lease; never bypass the deploy script.** Two revisions may run during
  a rollout (blue/green), but only the lease holder (`packages/server/src/lease/`, Azure Blob lease) opens the SQLite file.
  The share is mounted with `nobrl` (no SMB locks) and `SQLITE_JOURNAL_MODE=delete`; two writers corrupt the database, and
  there the lease is the only guard. Every DB write goes through the lease fence (`Db` `writeGuard`); no write after a failed
  renewal or past (last renewal + duration - safety margin). No Single revision mode, no second replica per revision.
- The `file` lease is for local disks only (dev, LAN compose, e2e), never for an SMB/NFS share; `WRITER_LEASE=none` only for
  one in-process instance (tests). New lease backends implement `WriterLease` and keep provider code in their own module.
- `/api/ready` = holds the lease (deploy script only). The platform probes must pass in standby: readiness on `/api/live`,
  liveness/startup on `/api/themes` (DESIGN #91). Azure runs `WRITER_LEASE_HANDOVER=on-traffic`: the script shifts the
  traffic to the new revision before the handover; only a process that never held the lease may break it, health
  probes (`kube-probe/`) and `/api/ready` / `/api/live` never trigger it.
- Exactly 1 replica (min=max=1), ingress `allowInsecure: false`, never set `POLY_TEST_MODE`, no secrets in outputs or script output,
  ACR admin user stays off (pull via managed identity).
- **No account keys (DESIGN #92):** `allowSharedKeyAccess` stays false (only the script's migration stage or the one-off
  `AZ_ALLOW_SHARED_KEY=1` rollback may turn it on); the share is mounted with the environment's managed identity
  (`azureFile.identity`, preview API), never with `accountKey`; no `listKeys()`, SAS, connection strings or `--account-key`
  anywhere (Bicep, script, docs); data-plane access is Entra ID (`--auth-mode login`) with a data role. Environment logs go
  through diagnostic settings (console + system only, never `ContainerAppHTTPLogs`), not the workspace key.
- Custom domain (DESIGN #53) is optional config (`AZ_CUSTOM_DOMAIN`, never in the repo); stages `hostname` -> `certificate` -> `bind` live in the
  script, and every domain step must leave exactly one active revision / replica (`assert_single_revision`).

## Docker / Caddy

- `Dockerfile`: pinned base image (version + digest), multi-stage, `npm ci --omit=dev`, no npm/build tools in runtime,
  non-root `1000:1000`, healthcheck kept. Lint with hadolint; update the digest deliberately (see comment in the file).
- `compose.yaml` (LAN) and `deploy/compose.prod.yaml` (Caddy + app): `read_only`, tmpfs `/tmp`, `cap_drop: [ALL]`,
  `no-new-privileges`, pids/memory limits; only `/data` writable; the app publishes no port behind Caddy.
- `deploy/Caddyfile`: automatic HTTPS, WebSocket proxy, GET/HEAD only outside `/api`, `/api/test*` denied, body limit,
  no query strings/cookies/tokens in logs, same security headers as the app (defence in depth). Validate with
  `docker run --rm -e DOMAIN=example.com -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 caddy validate --config /etc/caddy/Caddyfile`.
- Production env: `NODE_ENV=production`, `HTTPS_ONLY=1` behind HTTPS, optional `ALLOWED_ORIGINS`, `DATA_DIR=/data`.
