# Hochstapler 🇨🇭🇫🇷🇩🇪🇮🇹

A 3D property-trading board game for the browser, with a con-man travel agency as its theme ("Hochstapler" is German for
impostor, and also for someone who stacks things high). Pick a country, travel a 52-space board, buy places, build houses →
hotel → skyscraper, trade with counteroffers, gamble on securities, and play with friends via an invite link or against
bots. Languages: German, English, French, Italian and Lucerne Swiss German.

Play it at <https://hochstapler.openplace.net>.

## How it started

This began as a game to play at home with my son, on the couch, one laptop as the server and everybody else on a phone or
tablet. It grew from there into a hosted game with themes, bots and a decision log. Most of the code was written together
with AI coding agents (Claude Code, Codex); the 3D models were generated with Meshy and the Lucerne Swiss German texts were
drafted with GPT and proofread. Every decision, including the rejected ones, is recorded in
[docs/DESIGN.md](docs/DESIGN.md).

## License

Code: [MIT](LICENSE). 3D models and token images: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), see [NOTICE.md](NOTICE.md).
Security issues: see [SECURITY.md](SECURITY.md).

All design decisions: [docs/DESIGN.md](docs/DESIGN.md) · Assets: [docs/ASSETS.md](docs/ASSETS.md) · Rules for contributors
and coding agents: [AGENTS.md](AGENTS.md)

## Getting started

```bash
npm install
npm run dev        # server :8787 + client :5173 → http://localhost:5173
```

Production (one process serves API, WebSocket and client):

```bash
npm run build && npm start   # http://localhost:8787
```

## Playing at home on Wi-Fi (e.g. with your son)

One computer is the server; all other devices (laptop, tablet, phone) just play in the browser – nothing to install.

1. **On your Mac** (`npm install` once, then):

   ```bash
   npm run lan
   ```

   This builds the client and starts the server. The terminal shows something like:

   ```
   [hochstapler] im WLAN: http://192.168.1.24:8787 (en0)
   ```

   (`im WLAN` = "on Wi-Fi"; the log line is still in German.)

2. **Open this `192.168.…` address in the browser on your Mac** – not `localhost`!
   The invite link takes over the address you opened the page with; with `localhost` it would
   point nowhere on your son's device. (`en0` is usually Wi-Fi; if several `192.168.…`
   addresses are listed, pick the Wi-Fi one. `10.…`/`100.64.…` addresses are usually VPN/Tailscale.)
3. **Create a game** → pick a country, add as many bots as you like, time limit e.g. "Ohne Limit" (no limit) → in the lobby
   **"Einladungslink kopieren"** (copy invite link).
4. **Send the link to your son's device** (AirDrop, message) and open it there → enter a name → join.
   Both devices must be on the **same Wi-Fi**.
5. You start the game in the lobby. Done! 🎲

**Continuing on your phone:** menu → *Auf anderem Gerät weiterspielen* (continue on another device) → scan the QR code (or copy
the link). You keep playing there as the same person. The link is your seat: do not share it – if needed,
invalidate it with *Link erneuern* (renew link).

**If it does not work:**

- **On first start macOS asks "Eingehende Verbindungen für node erlauben?" (allow incoming connections for node?)** → *Erlauben* (allow). If you
  missed it: *System Settings → Network → Firewall → Options* → set `node` to "allow incoming connections".
- **Device does not load the page:** Is it really on the same Wi-Fi (not guest Wi-Fi, not mobile data)? Some
  routers isolate devices on the guest network from each other ("client isolation").
- **VPN active on the Mac?** It can block local connections – pause it briefly for the game.
- **Mac goes to sleep** → connection lost. For long games disable sleep or simply continue
  later: the game state is saved (`data/games.sqlite`); after `npm run lan` you continue with
  the same link.
- **Port in use?** `PORT=8790 npm run lan`.

Alternatively with Docker: `docker compose up -d --build`, then likewise open `http://<192.168.… address>:8787`
(the address of your Mac, not of the container).

## Playing online with friends

The server must be reachable from outside. The easiest way is a tunnel:

```bash
npm run build && npm start
cloudflared tunnel --url http://localhost:8787   # prints an https://….trycloudflare.com address
```

Then copy the invite link in the game (it uses the address you opened the page with).
For permanent operation a small host (Fly.io, Render, VPS) is suitable; game state lives in `data/games.sqlite`.

| Env variable | Default | Purpose |
|---|---|---|
| `PORT` | 8787 | HTTP/WS port |
| `DATA_DIR` | `./data` | Location of the SQLite file |
| `BOT_DELAY_MS` | 700 | Pause between bot actions |
| `GAME_TTL_LOBBY_DAYS` | 2 | A lobby (never started) is deleted after this many days without activity |
| `GAME_TTL_FINISHED_DAYS` | 30 | finished game: days until deletion |
| `GAME_TTL_RUNNING_DAYS` | 60 | running game without human activity: days until deletion |
| `ACTION_LOG_KEEP` | 2000 | newest action log entries kept per game |
| `TRUST_PROXY_HOPS` | 0 | reverse proxies in front of the app that append to `x-forwarded-for` (Caddy and Azure Container Apps: `1`). Per-client limits use the entry that many places from the **right**, never the leftmost one. Leave at 0 without a proxy |
| `GAME_CREATE_PER_HOUR` / `GAME_CREATE_BURST` | 10 / 5 | per client: games created (429 + `Retry-After` above) |
| `GAME_JOIN_PER_HOUR` / `GAME_JOIN_BURST` | 30 / 10 | per client: join requests |
| `MAX_OPEN_LOBBIES` / `MAX_RUNNING_GAMES` | 200 / 50 | server-wide caps (503 "server full") |
| `WS_MAX_PER_IP` | 20 | concurrent WebSockets per client |
| `CHAT_BURST` / `CHAT_PER_HOUR` | 5 / 1800 | chat messages per player (5 per 10 s; DESIGN #69). Chat text is never logged or stored |
| `POW_DIFFICULTY` | 100000 | proof of work for creating a game (DESIGN #70): largest counter a challenge can need. Values below 5000 abort the start in production; there is no switch that turns the check off |
| `POW_TTL_SEC` / `POW_CAPACITY` | 300 / 10000 | validity of a challenge, and how many live challenges the replay store holds (full = no new challenge, 503) |
| `POW_CHALLENGE_BURST` / `POW_CHALLENGES_PER_HOUR` | 20 / 120 | per client: challenges issued |
| `POW_HMAC_KEY` | random per process | optional fixed signing secret (32+ characters); never logged |
| `WRITER_LEASE` | `file` | who may open the database (DESIGN #89): `file` = lock file `writer.lease` next to the database (**local disks only**, never an SMB/NFS share); `azure-blob` = Azure Blob lease (set by `infra/main.bicep`); `none` = one in-process instance (tests; refused in production). A second instance on the same data asks the running one to hand over and takes over within seconds |
| `WRITER_LEASE_HANDOVER` | `immediate` | when a new instance asks the running one to hand over (DESIGN #91): `immediate` = at start (local, LAN, compose); `on-traffic` = on its first real request (set by `infra/main.bicep`; health probes with a `kube-probe/` user agent and `GET /api/ready` / `/api/live` do not count). A process that held the lease once never asks again |
| `WRITER_LEASE_ACCOUNT_URL` / `WRITER_LEASE_CONTAINER` | – | `azure-blob` only: `https://<account>.blob.core.windows.net` (no query, no SAS) and the container holding the lease blob |
| `AZURE_CLIENT_ID` | – | `azure-blob` only: client id of the user-assigned managed identity; the token comes from the Container Apps identity endpoint (`IDENTITY_ENDPOINT` / `IDENTITY_HEADER`, set by the platform). No account key |
| `POLY_TEST_MODE` | – | only `1` for the E2E tests (deterministic dice/fixtures); never in production |

## Hosting with Docker

One container serves API, WebSocket and client; game state lives in the volume `/data`.

```bash
docker compose up -d --build        # http://localhost:8787
```

Or without Compose:

```bash
docker build -t hochstapler .
docker run -d -p 8787:8787 -v hochstapler-data:/data --name hochstapler hochstapler
```

- Runs as user `1000:1000` (`node`), read-only root file system (only `/data` and `/tmp` writable),
  all capabilities dropped, health check on `/api/themes`, graceful shutdown on `SIGTERM`.
- For internet access put Caddy with automatic HTTPS in front: `deploy/compose.prod.yaml` starts Caddy + app,
  only Caddy publishes ports (80/443):

  ```bash
  DOMAIN=spiel.example.ch ACME_EMAIL=du@example.ch docker compose -f deploy/compose.prod.yaml up -d --build
  ```

  The configuration is in `deploy/Caddyfile` (WebSocket upgrade, GET/HEAD only outside `/api`, `/api/test*`
  blocked, body limit, access log without query string). Alternatively deploy on a container host (Fly.io, Render,
  Railway: the Dockerfile is detected; volume on `/data`, port 8787, set `HTTPS_ONLY=1`).

## Security

Everything is configured as restrictively as possible (details and rationale: decision #46 in
[docs/DESIGN.md](docs/DESIGN.md)): strict CSP and further security headers, no CORS (same-origin only, optionally
`ALLOWED_ORIGINS=https://a.example,https://b.example`), origin check on WebSocket upgrade, method/path allow list,
hardened container. Behind HTTPS set `HTTPS_ONLY=1` (HSTS + `upgrade-insecure-requests`; `deploy/compose.prod.yaml` does this).

```bash
npm run lint       # includes eslint-plugin-security + no-unsanitized (offline), part of `npm run check`
npm test           # incl. header/origin/allow-list tests (packages/server/test/hardening.test.ts)
npm run test:e2e   # every scenario fails on a CSP violation; e2e/security/csp.spec.ts
npm run security   # before every deploy: npm audit, lockfile-lint, gitleaks, osv-scanner, hadolint, trivy, caddy validate, semgrep
npm run security -- --fast   # without image build/Trivy image/Semgrep
```

`npm run security` needs network; the Docker steps are skipped with a notice when Docker is missing. Rules for
changes (new endpoints, headers, tokens): [AGENTS.md](AGENTS.md).

### Abuse limits and known residual risks

- **Limits** (DESIGN #59-#61): per-client rate limits for creating/joining games, global caps on lobbies and running games,
  a per-client WebSocket cap, invite-code failures counted per client and game, turn time >= 30 s (or off) and >= 2 missed
  turns before a player goes away. A **game without a connected human waits** and continues when someone returns (#60).
  Client addresses are only in-memory keys, never logged or exported.
- **Game ids are spectator links** (#62): anyone who knows a game id can watch (not act or chat). Telemetry only carries a
  salted hash of it.
- **Azure storage** (#63, #92, #95, #96): the share is mounted with the environment's managed identity, shared-key access
  on the storage account is off and no account key is read anywhere (Bicep, script, operators). Public network access stays on (accepted residual risk; a VNet would mean recreating
  the environment, domain and certificate).
- **Log Analytics / Application Insights** (#64, #92): the environment sends its logs through a diagnostic setting (no
  workspace key); Application Insights keeps key-based ingestion for the OpenTelemetry agent; junk telemetry is capped by the
  daily cap.
- **Runtime hardening on Azure** (#65): `tsx` compiles at start and Container Apps has no read-only root FS / `cap_drop`
  (the compose files have both).
- **Player tokens in `localStorage`** (#66): mitigated by the strict CSP, no DOM sinks and the fragment-only resume link.

## Hosting & updating on Hostinger (VPS)

**Prerequisites**

- A Hostinger VPS with the operating system template **Ubuntu with Docker** (Docker + Compose preinstalled), SSH access.
- A domain (or subdomain, e.g. `spiel.example.ch`) whose A record points to the VPS IP.
- Firewall (Hostinger panel or `ufw`): ports 22, 80 and 443 open. Port 8787 stays **closed**, the proxy talks to the container internally.

**First deployment**

```bash
git clone <your-repo> hochstapler && cd hochstapler
docker compose up -d --build      # builds the image, starts the container, creates the volume hochstapler-data
curl -s localhost:8787/api/themes # sign of life
```

`compose.yaml` mounts the named volume `hochstapler-data` on `/data` (SQLite file and backups) and gives the container
`stop_grace_period: 15s`. The health check lives in the Dockerfile (`docker ps` shows `healthy`).

**HTTPS with Caddy** (fetches and renews the certificate itself; WebSockets pass through without extra configuration):

```caddyfile
# /etc/caddy/Caddyfile
spiel.example.ch {
    reverse_proxy 127.0.0.1:8787
}
```

```bash
sudo apt install -y caddy && sudo systemctl reload caddy
```

To make the port reachable locally only, use `"127.0.0.1:8787:8787"` instead of `"8787:8787"` in `compose.yaml`.

**Updating**

```bash
cd hochstapler
git pull && docker compose up -d --build
```

What happens:

1. Compose builds the new image (every image has its own build ID, see below) and replaces the container. The old
   container receives `SIGTERM`, saves all games and closes the WebSockets with code `1012` ("Service Restart").
2. The new container migrates the database if needed (with an automatic backup in `data/backups`) and resumes running
   games including time limits and bots.
3. Players' browsers show "Update wird eingespielt – gleich zurück…" (update being applied – back shortly) and reconnect every 0.5–2 seconds. If
   the server reports a different build ID than the page, "Neue Version – wird geladen…" (new version – loading) appears and the page reloads
   as soon as running animations are finished (5 s wait at most). Nobody has to do anything; the game afterwards continues
   at the same point.

The **pause** is about 5–15 seconds depending on the VPS (container start; the build itself runs beforehand while the old game
keeps running). Honestly: SQLite allows only one writing process, so true zero-downtime blue/green does not
exist. A short interruption is normal, but neither game state nor moves are lost: an action is
either fully saved or rejected with an error message.

The **build ID** is `<git-sha>-<timestamp>`, or `local-<timestamp>` for Docker builds without `.git`; it is embedded in the client
(`__BUILD_ID__`) and in `dist/version.json`, which the server reads at startup and sends along in every `welcome`. To force your own ID:
`BUILD_ID=2026-11-01 docker compose up -d --build`. If only the server code changes and not the client,
the ID stays the same (Docker cache); the browsers then do not reload but still reconnect automatically.

**Rolling back**

```bash
git checkout <old-commit> && docker compose up -d --build   # code back; old version rebuilds
# or, if the old image is still there:
docker tag hochstapler:latest hochstapler:vorher                    # run BEFORE the update
docker tag hochstapler:vorher hochstapler:latest && docker compose up -d --no-build
```

If the new version migrated the database, the old one may no longer understand it. In that case first stop the container
(`docker compose stop`) and restore the backup. It lives in the volume under `backups/`:

```bash
docker run --rm -v hochstapler_hochstapler-data:/data alpine ls -l /data/backups          # volume name: <project folder>_hochstapler-data
docker run --rm -v hochstapler_hochstapler-data:/data alpine cp /data/backups/<file> /data/games.sqlite
```

**Logs**

```bash
docker compose logs -f --tail=100 hochstapler      # follow live
docker inspect --format '{{.State.Health.Status}}' $(docker compose ps -q hochstapler)
```

## Azure Container Apps

Hosting on Azure with the default HTTPS domain (`https://hochstapler.<env>.switzerlandnorth.azurecontainerapps.io`), entirely in
Bicep (`infra/main.bicep`). Decisions: #50 to #53, #89, #91, #92 (managed-identity mount), #94 (ready means "can write"),
#95 (SQLite without file locks) and #96 (identity-only cleanup) in [docs/DESIGN.md](docs/DESIGN.md).

**Prerequisites:** Azure CLI (`az login`), access to the subscription and the existing resource group `Hochstapler`
(it is not created). Copy `.env.azure.example` to `.env.azure` once (listed in `.gitignore`) and enter the
subscription ID (`AZ_SUBSCRIPTION`, plus `AZ_RESOURCE_GROUP`, optionally `AZ_APP_NAME`; alternatively as
environment variables). Before deploying, the script shows subscription, ID and resource group and asks for confirmation (`y/N`);
`--yes` skips the question. The script installs the `containerapp` extension if needed.

**Deploy and update (one command, repeatable at will):**

```bash
npm run deploy:azure                 # build infrastructure + image (az acr build) + roll out + wait for "healthy"
npm run deploy:azure -- --skip-build # the image of the current commit is already in the registry
npm run deploy:azure -- --yes        # without confirmation (e.g. in scripts)
npm run deploy:azure -- --infra-only # infrastructure only (no build); with a running app: with the running image
```

The script checks login, subscription and resource group, warns about uncommitted changes (the image then gets the tag
`<sha>-dirty-<time>`), tags the image with the short Git SHA (= `BUILD_ID`, clients reload on a new version) and prints the
HTTPS URL at the end. A run without changes builds nothing new.

**How an update works (important, DESIGN #89, #91):** The server keeps games in memory, runs bot timers and writes a single
SQLite file; two processes writing it at the same time destroy it. Only the holder of the **writer lease** (an Azure Blob
lease on `leases/writer.lease`, renewed every 3 s, 15 s duration) opens the file. The script rolls out blue/green:

1. the new revision starts with **0 % traffic** next to the running one, in standby (`WRITER_LEASE_HANDOVER=on-traffic`); the
   script waits until it is up (provisioned, running, replica ready, `/api/live` = 200; `STANDBY_TIMEOUT_SEC`, default 300);
2. the script shifts **100 % traffic** to it and sends one `GET /` to its revision FQDN: its first real request asks the
   running revision to hand over (Break Lease, 15 s);
3. the old revision drains (stops accepting actions, persists every game, pauses timers, closes the database), releases
   the lease and sends its players away with WebSocket code 4503; the new one takes the lease, runs a **write self-test**
   (one real write to the database, DESIGN #94) and only then becomes **ready** (`/api/ready` = 200 only while holding the
   lease and while writes work); the script logs how long that took;
4. the script deactivates the old revision, 5. checks that exactly one revision and replica is left.

Players see the "reconnecting" notice for the handover itself (a few seconds), no error page (DESIGN #91). If the new
revision does not come up in standby, it is deactivated and the traffic never moves ("rollout failed, previous revision
kept"). A new revision that takes the lease but cannot write (failed self-test) closes the database, gives the lease back
and steps aside for twice the rejoin delay; the old revision takes the lease back after its rejoin delay (30 s) and serves
again. The script sees the old revision answer 503 and then 200 again and rolls back at once: the traffic goes back, the new
revision is deactivated and the script fails with "rollout failed, previous revision kept". If the new revision does not hold
the lease within `HANDOVER_TIMEOUT_SEC` (default 240) and the old revision is ready again (now or within
`ROLLBACK_WAIT_SEC`, default 60), the same rollback; otherwise it falls back to stopping the old revision first and reports
`handover: fallback` (keep `HANDOVER_TIMEOUT_SEC + ROLLBACK_WAIT_SEC` above the 30 s rejoin delay; the script warns
otherwise). While a revision serves, three failed database writes in a row turn its `/api/ready` to 503 (`writes:
"failing"`, error log `database writes failing, not ready`); it keeps the lease, nothing hands over automatically.
So **never deploy the Bicep without the script**, and never open the database without holding the lease.

**Share authentication (managed identity only, DESIGN #92, #95, #96):** the environment mounts the share with its managed
identity (`id-hochstapler-pull`, the same one the app uses for the registry and the lease; role "Storage File Data SMB MI
Admin" on the storage account, SMB OAuth + Kerberos) through the storage definition `hochstapler-data-mi` (preview API).
Shared-key access on the storage account is off and no account key is read anywhere: not in Bicep, not in the script,
not by operators. The platform ignores the volume's `mountOptions` on this mount (no `nobrl`), so SQLite runs without file
locks (`SQLITE_LOCKING=none`, #95) and the writer lease is the only guard. If the managed-identity mount ever breaks (the
preview changes or is withdrawn), the way back is reverting the #96 cleanup and deploying: that brings the key-based
definition and shared-key access back (#94).

**What gets created** (everything in the resource group, names from `uniqueString`): Container Registry Basic (no admin user,
pull via managed identity), Storage Account Standard LRS with Azure Files share `data` (mount `/data`,
soft delete 14 days; mounted with the managed identity, shared-key access off, see above), Log Analytics
(30 days, daily cap 0.1 GB; the environment's console and system logs arrive through a diagnostic setting, not with the
workspace key), Container Apps Environment (with the user-assigned identity), the app
(1 replica, 0.5 vCPU / 1 GiB, startup/liveness probes on `/api/themes`, readiness on `/api/live` (both answer in standby),
`terminationGracePeriodSeconds: 20`), a private blob container `leases` for the writer lease with the role "Storage Blob Data
Contributor" for the app's managed identity on that container only (no account key, no SAS). The app runs with
`NODE_ENV=production`, `HTTPS_ONLY=1`, `DATA_DIR`, `SQLITE_JOURNAL_MODE=delete` (WAL is unsafe over SMB), `SQLITE_LOCKING=none` (SQLite takes no file locks; the writer lease is the guard, see DESIGN #95). The database folder
is determined by `dataDir` in `infra/main.bicepparam` (default `/data`; currently `/data/v2`, see #52).

**Custom domain (optional, free managed certificate):** Set `AZ_CUSTOM_DOMAIN=game.example.com` in `.env.azure` (or the environment)
and create **two records** at your DNS provider:

| Type  | Name                         | Value                                                             |
| ----- | ---------------------------- | ----------------------------------------------------------------- |
| CNAME | `game.example.com`           | FQDN of the app (`az containerapp show -g Hochstapler -n hochstapler --query properties.configuration.ingress.fqdn -o tsv`) |
| TXT   | `asuid.game.example.com`     | `az containerapp show -g Hochstapler -n hochstapler --query properties.customDomainVerificationId -o tsv` |

Then run `npm run deploy:azure` (again). The script first checks via `dig` whether both records are correct; if something is missing, it names
the exact record and continues deploying **without** the domain (no error). Otherwise it runs in three stages (`customDomainStage` in
`main.bicep`): `hostname` (hostname on the app, without TLS binding), `certificate` (managed certificate, validation via CNAME,
takes a few minutes) and `bind` (`SniEnabled` with the certificate). This is necessary because the certificate is only
issued for a hostname that is already attached to the app. Further runs detect the finished state and change nothing (no new revision,
no new certificate). The domain stages are app configuration and create **no** revision; afterwards the script checks that
at most one replica is running (#52). The WebSocket origin check (Origin against Host) works on the custom domain without
`ALLOWED_ORIGINS`; HSTS/CSP are identical on both hosts, `http://` is redirected to `https://`. The `*.azurecontainerapps.io` URL
stays valid. Removing the setting removes the domain from the app again on the next deploy. Decision: #53.

**Costs (estimate, USD/month):** app about 10-35 (consumption, 1 replica around the clock; idle rate when nobody is playing,
with bots running continuously rather at the top; 180,000 vCPU-s and 360,000 GiB-s per month are free), Container Registry Basic about 5,
storage and Log Analytics together under 1. **Total about 15-40.** Less: 0.25 vCPU / 0.5 GiB in `main.bicep` (halves the
app costs). Current prices: Azure Pricing Calculator.

**Viewing logs:**

```bash
az containerapp logs show -g Hochstapler -n hochstapler --type console --tail 100          # console of the running app
az containerapp logs show -g Hochstapler -n hochstapler --type system --tail 100           # platform events
az containerapp revision list -g Hochstapler -n hochstapler -o table                       # revisions, health
az monitor log-analytics query -w <workspace-customerId> --analytics-query \
  "ContainerAppConsoleLogs | where TimeGenerated > ago(1h) | project TimeGenerated, RevisionName, Log | order by TimeGenerated desc | take 100"
```

**Backups and restore:** There are two safety nets. (1) On a schema update the app creates a `VACUUM INTO` backup in
`/data/backups/` (see "Database & migrations"). (2) The share has **soft delete (14 days)**: deleted files/shares
can be recovered.

```bash
ACC=$(az storage account list -g Hochstapler --query "[0].name" -o tsv)
# restore a deleted share (soft delete)
az storage share-rm list -g Hochstapler --storage-account $ACC --include-deleted -o table
az storage share-rm restore -g Hochstapler --storage-account $ACC --name data --deleted-version <version>   # version from the list
# restore a backup file: stop the app (deactivate revision), replace the file in the share, activate revision
az containerapp revision deactivate -g Hochstapler -n hochstapler --revision <revision>
az storage file download --account-name $ACC --share-name data --path backups/<file> --dest ./games.sqlite --auth-mode login --enable-file-backup-request-intent
az storage file upload   --account-name $ACC --share-name data --source ./games.sqlite --path games.sqlite --auth-mode login --enable-file-backup-request-intent
az containerapp revision activate -g Hochstapler -n hochstapler --revision <revision>
```

(Entra ID is the only way, shared-key access is off: `--auth-mode login` needs the role "Storage File Data Privileged Contributor" for your account and
`--enable-file-backup-request-intent`; the portal's file browser needs the same role and "Microsoft Entra user account" as
authentication method. Azure Backup for Azure Files is not configured.) Back up the old file before
restoring; deactivate **every** active revision first (a standby revision would take the lease over and open the file).

**Cleaning up:** The resource group stays; only the created resources are deleted:

```bash
az containerapp delete -g Hochstapler -n hochstapler --yes
az containerapp env delete -g Hochstapler -n cae-hochstapler --yes
az acr delete -g Hochstapler -n $(az acr list -g Hochstapler --query "[0].name" -o tsv) --yes
az storage account delete -g Hochstapler -n $(az storage account list -g Hochstapler --query "[0].name" -o tsv) --yes   # deletes the saved games
az monitor log-analytics workspace delete -g Hochstapler -n $(az monitor log-analytics workspace list -g Hochstapler --query "[0].name" -o tsv) --yes
az identity delete -g Hochstapler -n id-hochstapler-pull
```

## Telemetry (OpenTelemetry)

The server can export traces, logs and metrics via **OpenTelemetry (OTLP)**, vendor-neutral and **only when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set**. Without this variable no SDK is loaded (no overhead, playing on Wi-Fi
stays unchanged). Logs are only warnings, errors and a few info records (start, schema migration, retention sweep, shutdown), carry the trace id of the active span and never the text of an error. Decisions and rationale: entries #54-#56 and #74 in [docs/DESIGN.md](docs/DESIGN.md).

**Locally with the Aspire AppHost** (development only, DESIGN #71). `apphost/` is a TypeScript
[Aspire](https://aspire.dev) AppHost that starts the game server (`npm run dev -w @poly/server`, tsx watch), the Vite
client and the Aspire dashboard, and injects the `OTEL_*` variables into the server. Games stay in the normal `data/`
directory.

Prerequisites: Node 26 (as for everything else), the [Aspire CLI](https://aspire.dev/get-started/install-cli/)
(`aspire --version`), Docker is **not** needed. A .NET SDK is not required to run a TypeScript AppHost (the CLI brings
its own AppHost server; the machine this was built on had .NET 10 installed anyway, so this is unverified without it).

```bash
npm run aspire        # npm ci in apphost/, then `aspire run`: prints the dashboard URL (with a one-time login token)
aspire describe       # resources: server (http://localhost:8787) and client (http://localhost:5173), health
aspire logs server    # console output of a resource
aspire otel traces server        # one line per trace (game.action, db.save, POST /api/games/:id/start ...)
aspire otel spans server         # all spans, newest last
aspire otel logs server          # OTLP logs (the server exports none, only traces and metrics)
aspire stop           # stops everything, also when `aspire run` runs detached (`aspire run --detach`)
```

The ports are fixed (server 8787, client 5173, like `npm run dev`), so stop `npm run dev` before `npm run aspire`.
The dashboard is protected by Aspire's login token and the OTLP endpoint by an API key, both generated per run. Aspire
sets `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`, which the server's SDK honours. The service name is the resource name
(`server`). `aspire agent init` (already run, results committed) installed the `aspire`, `aspire-monitoring` and
`aspire-orchestration` skills in `.claude/skills/` and `.mcp.json`, so a coding agent can read resources, logs and
traces of the running game itself. The AppHost is typechecked and linted on its own because it needs the Aspire CLI
to generate its SDK: `npm run typecheck --prefix apphost && npm run lint --prefix apphost`.

Without the Aspire CLI (or for traces of the e2e runs) any OTLP receiver works, e.g. `aspire dashboard run`; then start
with `OTEL_EXPORTER_OTLP_ENDPOINT=<its OTLP endpoint> npm run dev` (or `npm run test:e2e`; service `hochstapler-e2e`).
There is deliberately no compose profile for it any more (one way, DESIGN #71).

In the dashboard: *Traces* (spans `game.action`, `db.save`, `db.append_action`, `db.load`, `GET /api/games/:id/join` ...)
and *Metrics* (`hochstapler.action.duration`, `hochstapler.db.write.duration`, `hochstapler.ws.connections`,
`hochstapler.rooms.loaded`, `hochstapler.games.running`, `hochstapler.bot.moves`, `hochstapler.ws.reconnects`,
`hochstapler.ws.origin_rejected`, `hochstapler.http.rejected`, `hochstapler.games.expired`, `hochstapler.actions.trimmed`). All standard variables apply (`OTEL_SERVICE_NAME`,
`OTEL_TRACES_SAMPLER`, `OTEL_EXPORTER_OTLP_PROTOCOL` = `grpc` | `http/protobuf` | `http/json`, `OTEL_SDK_DISABLED=true`).
`service.version` is the build ID. Attributes never contain tokens, invite codes, names or IP addresses; HTTP spans
carry only method, route template and status.

**Azure:** The Bicep creates a **workspace-based Application Insights** (`appi-hochstapler`) that stores in the existing
Log Analytics workspace, and enables the **managed OpenTelemetry agent** of the Container Apps environment
(traces + logs -> Application Insights). The agent sets `OTEL_EXPORTER_OTLP_ENDPOINT` in the app (gRPC only); the app
keeps 20 % of traces (`parentbased_traceidratio`, parameter `traceSampleRatio`). The Application Insights endpoint of the
agent accepts **no metrics**: on Azure there are therefore traces (durations as span runtimes); counters and gauges only locally.

- Portal: Application Insights `appi-hochstapler` -> *Transaction search* / *Performance* / *Application map* (German portal: *Transaktionssuche* / *Leistung* / *Anwendungsübersicht*).
- Queries (KQL in the workspace or in Application Insights -> Logs):

  ```kusto
  AppRequests | where TimeGenerated > ago(1h) | summarize count(), avg(DurationMs) by Name
  AppDependencies | where Name startswith "db." | summarize avg(DurationMs), percentile(DurationMs, 95) by Name
  AppRequests | where Name == "game.action" | summarize count(), avg(DurationMs) by tostring(Properties["game.action.type"])
  ```

- **Costs:** Application Insights stores in the workspace; daily caps (0.1 GB/day) and retention (30 days) apply, so
  costs stay bounded (per GB ingestion at workspace price, the first 5 GB/month are free). The agent itself
  is free.
- **Switching off:** Bicep parameter `enableTelemetry=false` (no resources, no `OTEL_*` variables), or only the app:
  `OTEL_SDK_DISABLED=true` as an environment variable. Locally: do not set the `OTEL_EXPORTER_OTLP_ENDPOINT` variable.

## Tests & quality

```bash
npm test           # engine (rules, bots, fuzz) + server (REST, WS, security)
npm run typecheck
npm run test:e2e   # browser scenarios (Playwright-BDD, English Gherkin) – desktop + mobile, ~2 min.
npm run test:e2e:ui
```

The scenarios live in `e2e/features/*.feature`, the steps in `e2e/steps/`. `npm run test:e2e` builds the client and
starts the server in **test mode** (`POLY_TEST_MODE=1`, only there `/api/test/*` exists: set dice sequence,
load game-state fixtures; in production the server refuses to start with it). Details: decision #28 in
[docs/DESIGN.md](docs/DESIGN.md).

The suite's client bundle is built with `POLY_E2E_HOOKS=1` (set by the Playwright web server command). Only that
bundle contains `window.__polyTest` (projected board corners and the camera insets, used by the "board is not covered
by the HUD" layout assertion); every other build, production included, compiles the hook out (`__E2E_HOOKS__`,
`packages/client/src/e2e-hooks.ts`, covered by `packages/client/test/e2e-hooks.test.ts`).

### Responsive suite (layout + screenshots)

```bash
npm run test:responsive          # 6 viewports × ~25 states, plus language / zoom / keyboard variants (plain Playwright tests in e2e/responsive/), ~1 min.
npm run test:responsive:update   # rewrite screenshot baselines (= --update-snapshots)
```

Viewports (Chromium): `se-320`, `phone-390`, `phone-landscape` (844×390), `tablet-portrait`, `tablet-landscape`,
`desktop-1440`. Each test reaches its state via REST + test-mode fixtures and checks generic layout rules
(`e2e/support/layout.ts`: no horizontal overflow, controls within the viewport and not covered, touch targets ≥ 44 px,
no clipped text, action bars visible without scrolling) as well as a screenshot (`maxDiffPixelRatio` 1 %).
The WebGL canvas is hidden via `e2e/support/screenshot.css`, animations are off, fonts are
self-hosted (`@fontsource`), the postmark date is fixed in lite mode. Baselines live in
`e2e/__screenshots__/<viewport>/`. After an intended UI change regenerate with `npm run test:responsive:update`,
review the changed PNGs and check them in. Single viewport: `npx playwright test --project=se-320`.

Code reviews with the skill `.claude/skills/typescript-code-review`.

## Securities (optional)

On the start page the "Wertpapiere" (securities) mode can be switched on (default: off) and the lock period chosen (1–10
rounds, default 3). Per country there are six invented, tongue-in-cheek companies (e.g. in Switzerland "Pilatus
Bergbahnen AG" or the very unpunctual "SBB Pünktlichkeits-AG"). Prices move at the end of each round: a
random walk per sector, coupled to what happens in the game (building in tourist regions lifts tourism, a
bankruptcy pushes down the bank, many rents support real estate …), plus rare headlines with boom or crash.
You may buy on your own turn; afterwards the position is locked for a few rounds. Only when in debt is there an
emergency sale with a 20 % discount. Securities count towards net worth (round-limit winner). **Dividends** (house rule,
on by default with the mode): at the end of each round every holder gets price × yield per share as cash (locked
positions too); the yield depends on the sector and on the price relative to the issue price, below 70 % of it there is
no dividend; rarely a company pays a special dividend or skips it. From round 20 the yields decay stepwise
(−20 % of the base yield per 10 rounds) and stop after round 60, so long games are not financed by dividends forever.
Details: decision #40/#48/#81/#84
in [docs/DESIGN.md](docs/DESIGN.md); the UI is the "Wertpapiere" tab (phone: in the bottom menu).

## Show-off mode (optional)

The "Protzmodus" house rule on the start page (default: off) lets players borrow from the bank to buy and build
faster. On your own turn, with no payment pending, you borrow in steps of 100 up to half the starting cash. The bank
fixes the interest rate when you borrow, from your net worth compared with the table: 4 % per round for the poorest,
8 % at the average, 25 % for the richest (linear in between). The interest is due in cash at the start of each of your
turns (if you cannot pay, the usual debt rules apply: mortgage, sell buildings, else bankruptcy); repay any time on
your own turn, the most expensive part first. Loans count against the net worth and vanish with a bankrupt player.
The UI is the "Kredit" button in the action bar (phone: in the action row while it is your turn). Details and the
balance measurement: decision #93 in [docs/DESIGN.md](docs/DESIGN.md); rerun it with
`node packages/engine/test/loan-balance-run.ts <bots|proxy> <off|on> <fromSeed> <toSeed> [p/a/r]` and
`... report <files>`.

## Database & migrations

Multi-day games must never be lost through an update. Therefore there are two separate, versioned layers
(decision #43 in [docs/DESIGN.md](docs/DESIGN.md)).

**Upgrading your games:** stop the server (`Ctrl+C` on `npm run lan`), fetch the new version, start `npm run lan`.
On startup the following happens automatically (and before games are loaded): database backup → migration in **one**
transaction → log lines `[db] backup written …` / `[db] schema is now at version N`. If a migration fails,
it is rolled back and the server does **not** start (message "Startup aborted …"); the database stays unchanged.
A game whose saved state cannot be read (or comes from a newer version) is reported in the
log and is unavailable – it is never overwritten or deleted.

**Backups** live in `data/backups/games-<timestamp>-v<old version>.sqlite` (only when migrations are pending;
the last 10 are kept). **Restoring:** stop the server, delete `data/games.sqlite-wal` and `data/games.sqlite-shm`,
copy the desired backup to `data/games.sqlite`, start the server of the **matching older version**
(an older version refuses a newer database with a clear message).

**1. Schema migration (SQLite tables/indexes)** – `packages/server/src/migrations/schema.ts`
1. Append a new `{ version, name, up(db) }` at the **end** of `SCHEMA_MIGRATIONS` (numbers without gaps; never change shipped
   migrations). `up` must not issue `BEGIN/COMMIT`, throwing aborts everything. The version is stored in
   `PRAGMA user_version`.
2. Add a test in `packages/server/test/schema-migrations.test.ts` (red/green); `games-v0.sqlite` is an
   anonymised copy of a real old database (4 games).

**2. Game state migration (JSON in `games.state_json`)** – `packages/engine/src/migrations.ts`
If `GameState` changes in a way that is **not purely additive-optional** (new required field, rename, different meaning):
1. Change the field in `types.ts` **and** `state-schema.ts` (the compile-time drift check reports when they diverge).
2. Increase `CURRENT_STATE_VERSION` by 1 and append a pure step `vN → vN+1` to `STATE_STEPS`
   (untyped JSON in, JSON out, mutate nothing, deterministic).
3. Add a fixture `packages/server/test/fixtures/state-v<N+1>-<kind>.json` (e.g. apply `migrateState` to an old fixture
   or anonymise a real game: player names → Anna/Ben/Clara, replace tokens/invite codes).
   The old `state-v1-*.json` stay **unchanged** – they are the proof that old games keep running
   (example: version 2 = securities mode, step `migrateV1toV2`, fixtures `state-v2-*.json`).
4. `npm test` – `state-fixtures.test.ts` checks for **every** fixture of every old version: `migrateState` → current
   `GameStateSchema` → engine invariants → bots keep playing. A new required field without a migration step turns
   this test red.
The version of a game is stored in `games.state_version`; older states are migrated in memory on load and written in the new version
on the next save. Purely additive, optional fields (`autoBids?`, `LogEntry.msg?`)
need no migration. Lobby JSON (`StoredLobbySchema`) is validated just as thoroughly; if its shape changes,
a schema migration rewrites the rows (`up(db)` may read/write `lobby_json`).

## Retention (privacy & database size)

To keep the database small (on Azure Files every write access costs time), the server deletes inactive games
and trims the action log (decision #57 in [docs/DESIGN.md](docs/DESIGN.md)).

- **Who counts as active?** Only humans: game actions, joining, changes in the lobby, game start and a
  player with a seat who opens the game. Bots and time limits do **not** keep a game alive (otherwise a
  game with bots would never expire). Spectators do not count.
- **Deadlines** (from the last human activity): lobby 2 days, finished game 30 days, running game 60 days.
  Configurable with `GAME_TTL_LOBBY_DAYS`, `GAME_TTL_FINISHED_DAYS`, `GAME_TTL_RUNNING_DAYS` (integers ≥ 1);
  invalid values prevent startup (empty = default).
- **Action log:** the newest 2000 entries per game are kept (`ACTION_LOG_KEEP`). The log serves only
  traceability; games are loaded from the saved state and never replayed from it.
- **Procedure:** at startup (before games are resumed) and hourly thereafter, in **one** transaction (delete game including
  actions, trim logs). Afterwards `VACUUM`, but only if at least 1 MiB has been freed.
  Open connections of a deleted game are closed with code 4404; the browser shows "Dieses Spiel ist
  abgelaufen oder existiert nicht" (this game has expired or does not exist) with a way back to the start page and forgets the saved key.
- **Observable:** log lines only on errors; metrics `hochstapler.games.expired` (by status) and
  `hochstapler.actions.trimmed`, span `retention.sweep` (numbers only, no names or keys).
- The migration to schema version 3 (column `last_activity_at`, initial value `updated_at`) creates a backup beforehand like every migration.

## 3D models (Meshy)

```bash
echo "MESHY_API_KEY=msy_..." > .env.local     # gitignored
npx tsx scripts/meshy/generate.ts --dry-run    # list + credit estimate
npx tsx scripts/meshy/generate.ts              # generate, optimise, register in the manifest
npm run assets:tokens                          # re-render the 2D token thumbnails from the token GLBs
```

The 2D UI shows each game piece as a 256 px WebP (`packages/client/public/assets/tokens/<id>.webp`, ~130 KB for all 32),
rendered from `token-<id>.glb` by headless Chromium (`scripts/tokens/render-thumbnails.mjs`; contact sheet in
`/tmp/tokens-thumbs/contact.png`). Re-run it after changing a token model and commit the images.

## Structure

```
packages/engine   rules, bots, themes, zod schemas (pure, deterministic)
packages/server   Node: REST + WebSocket + SQLite, bot/timer scheduler
packages/client   Vite + Three.js + Preact
e2e               Playwright-BDD scenarios (top of the test pyramid)
scripts/meshy     asset pipeline
scripts/tokens    token thumbnails (2D UI) rendered from the GLBs
deploy/           Caddyfile + compose.prod.yaml (HTTPS deployment)
docs/             design decisions, asset briefs
```
