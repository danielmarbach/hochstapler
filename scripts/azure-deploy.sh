#!/usr/bin/env bash
# Hochstapler -> Azure Container Apps: first deploy AND every update (idempotent, safe to re-run). See README
# "Azure Container Apps" and docs/DESIGN.md #50-#52.
#
#   scripts/azure-deploy.sh                 # infra + build image + roll out
#   scripts/azure-deploy.sh --skip-build    # infra + roll out the image of the current commit (must be in the registry)
#   scripts/azure-deploy.sh --infra-only    # infra only (first run: no app yet; later: re-apply with the running image)
#   --yes                                   # skip the confirmation of subscription / resource group
# Needs AZ_SUBSCRIPTION (environment or the gitignored .env.azure, template .env.azure.example).
# Optional AZ_CUSTOM_DOMAIN: custom domain with a free managed certificate (DNS is checked first, README, DESIGN #53).
#
# Update strategy (blue/green with the writer lease, DESIGN #89, traffic first #91; replaces the stop-first rollout of
# #52): the app writes ONE SQLite file on Azure Files (mounted with `nobrl`, no byte-range locks), and only the holder of
# the writer lease (an Azure Blob lease) opens it. A new revision starts with 0 % traffic in standby
# (WRITER_LEASE_HANDOVER=on-traffic: it asks the running one to hand over only on its first real request). The traffic
# moves to it first, then a request starts the handover: the old one drains (persists, closes the database, releases the
# lease, sends its players away with 4503) and the new one takes the lease: the players' gap is the handover itself.
#   1. new revision with 0 % traffic (Multiple revision mode, 1 replica)
#   2. wait until it is up in standby (provisioned, running, replica ready, /api/live 200; STANDBY_TIMEOUT_SEC, default 300)
#   3. 100 % traffic to it   4. trigger: GET / on its own FQDN
#   5. wait until /api/ready is 200 (= holds the lease; HANDOVER_TIMEOUT_SEC, default 240)
#   6. deactivate the old revision   7. assert a single active revision
# Not up in standby -> the new revision is deactivated, the traffic never moved: "rollout failed, previous revision kept".
# Not ready in time -> if the old revision is ready again (it rejoins after 2 x the lease duration) or becomes ready within
# ROLLBACK_WAIT_SEC (default 60): traffic back to it, new revision deactivated, "rollout failed, previous revision kept",
# exit 1. Otherwise the hard fallback: deactivate the old revision (it releases the lease on SIGTERM, or the break period
# runs out), wait for the new one again, report "handover: fallback".
# One-time migration: a running revision WITHOUT WRITER_LEASE=azure-blob does not know the lease, so it is stopped
# first (the old behaviour) before the new revision starts.
#
# No storage keys (DESIGN #92): the share is mounted with the environment's managed identity (storage definition
# hochstapler-data-mi) and shared-key access is off. Two stages, chosen automatically: while an ACTIVE revision still
# mounts through the old key-based definition hochstapler-data, every deployment keeps shared-key access on (stage 1:
# the new revision mounts with the identity, the old one keeps working until the handover); the next run, with no key
# mount left, turns shared-key access off and removes the old definition (stage 2). AZ_ALLOW_SHARED_KEY=1 keeps the key
# on (rollback lever, see README).
#
# bash 3.2 compatible (macOS): no associative arrays, no mapfile.
set -euo pipefail


SKIP_BUILD=0
INFRA_ONLY=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --infra-only) INFRA_ONLY=1 ;;
    --yes | -y) ASSUME_YES=1 ;;
    -h | --help)
      sed -n '2,38p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (allowed: --skip-build, --infra-only, --yes)" >&2
      exit 2
      ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# settings come from the environment or the optional, gitignored .env.azure (template: .env.azure.example)
if [ -f .env.azure ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.azure
  set +a
fi
SUBSCRIPTION="${AZ_SUBSCRIPTION:-}"
RESOURCE_GROUP="${AZ_RESOURCE_GROUP:-Hochstapler}"
APP_NAME="${AZ_APP_NAME:-hochstapler}"
IMAGE_REPO="hochstapler"
CUSTOM_DOMAIN="${AZ_CUSTOM_DOMAIN:-}"
DOMAIN=""           # domain handed to Bicep (empty = none, or DNS not ready)
DOMAIN_STAGE="hostname"
TRAFFIC_REVISION="" # blue/green: the running revision keeps all traffic while the new one starts (empty = latest)
HANDOVER_TIMEOUT_SEC="${HANDOVER_TIMEOUT_SEC:-240}"
STANDBY_TIMEOUT_SEC="${STANDBY_TIMEOUT_SEC:-300}"
ROLLBACK_WAIT_SEC="${ROLLBACK_WAIT_SEC:-60}"
MI_STORAGE="hochstapler-data-mi"   # environment storage definition with managed-identity auth (infra/main.bicep)
LEGACY_STORAGE="hochstapler-data" # key-based definition of earlier versions, removed in stage 2 (DESIGN #92)
SHARED_KEY="false"                # allowSharedKeyAccess handed to Bicep
SHARED_KEY_STAGE=""               # '' = no migration, 'stage1' = an active revision still mounts with the key

log() { printf '==> %s\n' "$*"; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}
azq() { az "$@" --only-show-errors; }

# ---------- prerequisites ----------
[ -n "$SUBSCRIPTION" ] || die "AZ_SUBSCRIPTION is not set. Copy .env.azure.example to .env.azure and enter the subscription ID (or set AZ_SUBSCRIPTION in the environment)."
command -v az > /dev/null || die "Azure CLI (az) is missing."
command -v git > /dev/null || die "git is missing."
command -v curl > /dev/null || die "curl is missing."
az account show > /dev/null 2>&1 || die "Not signed in to Azure: az login"
azq account set --subscription "$SUBSCRIPTION" || die "Subscription $SUBSCRIPTION is not available."
SUB_NAME="$(azq account show --query name -o tsv)"
[ "$(azq group exists -n "$RESOURCE_GROUP")" = "true" ] || die "Resource group '$RESOURCE_GROUP' does not exist (intentionally not created)."
echo "Target: subscription '$SUB_NAME' ($SUBSCRIPTION), resource group '$RESOURCE_GROUP', app '$APP_NAME'"
if [ "$ASSUME_YES" != "1" ]; then
  [ -t 0 ] || die "No interactive input: confirm with --yes."
  printf 'Deploy there? [y/N] '
  read -r answer
  case "$answer" in
    y | Y | yes | YES | j | J | ja | Ja) ;;
    *) die "Aborted." ;;
  esac
fi
if ! az extension show --name containerapp > /dev/null 2>&1; then
  log "Installing the Azure CLI extension 'containerapp' (one-time)"
  azq extension add --name containerapp --upgrade -y > /dev/null
fi
log "Compiling Bicep"
azq bicep build --file infra/main.bicep --stdout > /dev/null

DIRTY=0
if [ -n "$(git status --porcelain)" ]; then
  DIRTY=1
  echo "WARNING: working tree has uncommitted changes; the image contains them but gets the tag '-dirty-<time>'." >&2
fi
SHA="$(git rev-parse --short=8 HEAD)"
if [ -n "${DEPLOY_TAG:-}" ]; then
  TAG="$DEPLOY_TAG" # explicit tag (tests of the script itself); an existing tag is never rebuilt
elif [ "$DIRTY" = "1" ]; then
  TAG="${SHA}-dirty-$(date -u +%Y%m%d%H%M%S)"
else
  TAG="$SHA"
fi

deploy_bicep() { # deploy_bicep <deployApp true|false> [image]
  local deploy_app="$1" image="${2:-}"
  azq deployment group create \
    --resource-group "$RESOURCE_GROUP" \
    --name "hochstapler-$(date -u +%Y%m%d%H%M%S)" \
    --template-file infra/main.bicep \
    --parameters infra/main.bicepparam \
    --parameters deployApp="$deploy_app" image="$image" buildId="$TAG" \
    ${HOCHSTAPLER_DATA_DIR:+dataDir="$HOCHSTAPLER_DATA_DIR"} \
    ${DOMAIN:+customDomain="$DOMAIN" customDomainStage="$DOMAIN_STAGE"} \
    ${TRAFFIC_REVISION:+trafficRevision="$TRAFFIC_REVISION"} \
    allowSharedKeyAccess="$SHARED_KEY" \
    -o none
}
app_exists() { az containerapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --only-show-errors > /dev/null 2>&1; }

# ---------- 0. shared-key removal stage (DESIGN #92) ----------
# Fail closed: any active revision whose Azure Files volume is not the managed-identity definition (including an unknown
# answer) may still mount with the account key, so the key stays allowed in this run.
resolve_shared_key() {
  local revs rev mount
  if [ "${AZ_ALLOW_SHARED_KEY:-}" = "1" ]; then
    SHARED_KEY="true"
    echo "WARNING: AZ_ALLOW_SHARED_KEY=1: shared-key access to the storage account stays ON (rollback lever)." >&2
    return 0
  fi
  app_exists || return 0
  if ! revs="$(azq containerapp revision list -g "$RESOURCE_GROUP" -n "$APP_NAME" --query "[?properties.active].name" -o tsv)"; then
    SHARED_KEY="true"
    SHARED_KEY_STAGE="stage1"
    log "shared-key removal: stage 1 (could not list the active revisions): shared-key access stays on in this run"
    return 0
  fi
  for rev in $revs; do
    mount="$(azq containerapp revision show -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$rev" \
      --query "properties.template.volumes[?storageType=='AzureFile'].storageName | [0]" -o tsv 2> /dev/null || true)"
    if [ "$mount" != "$MI_STORAGE" ]; then
      SHARED_KEY="true"
      SHARED_KEY_STAGE="stage1"
      log "shared-key removal: stage 1 (revision $rev mounts the share through '${mount:-unknown}', not $MI_STORAGE): shared-key access stays on in this run"
      return 0
    fi
  done
}
resolve_shared_key
remove_legacy_storage() { # stage 2: nothing mounts with the key any more and shared-key access is off
  [ "$SHARED_KEY" = "false" ] || return 0
  azq containerapp env storage list -g "$RESOURCE_GROUP" -n "$ENV_NAME" --query "[].name" -o tsv 2> /dev/null \
    | grep -qx "$LEGACY_STORAGE" || return 0
  log "shared-key removal: stage 2, removing the old key-based storage definition $LEGACY_STORAGE"
  azq containerapp env storage remove -g "$RESOURCE_GROUP" -n "$ENV_NAME" --storage-name "$LEGACY_STORAGE" --yes > /dev/null \
    || echo "WARNING: could not remove $LEGACY_STORAGE (still referenced by an inactive revision?); its key no longer works. Remove it later: az containerapp env storage remove -g $RESOURCE_GROUP -n $ENV_NAME --storage-name $LEGACY_STORAGE --yes" >&2
}

# ---------- 1. platform: registry, storage, environment, identity (no app yet) ----------
log "Rolling out infrastructure (registry, storage, environment, logs)"
deploy_bicep false ""
ACR_NAME="$(azq acr list -g "$RESOURCE_GROUP" --query "[?starts_with(name, 'crhochstapler')].name | [0]" -o tsv)"
ACR_SERVER="$(azq acr show -g "$RESOURCE_GROUP" -n "$ACR_NAME" --query loginServer -o tsv)"
[ -n "$ACR_NAME" ] || die "Could not determine the registry name."

# ---------- 1b. custom domain: DNS must be right first, otherwise continue without it (never fails the deploy) ----------
ENV_NAME="$(azq containerapp env list -g "$RESOURCE_GROUP" --query "[0].name" -o tsv)"
dns_lookup() { dig +short "$@" 2> /dev/null | sed 's/"//g; s/\.$//' | tr 'A-Z' 'a-z'; } # dig prints TXT with quotes, CNAME with trailing dot
domain_binding() { # current binding type of the custom domain on the app ('' = not on the app)
  app_exists || return 0
  azq containerapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" \
    --query "properties.configuration.ingress.customDomains[?name=='$CUSTOM_DOMAIN'].bindingType | [0]" -o tsv 2> /dev/null || true
}
managed_cert_ready() {
  [ -n "$(azq containerapp env certificate list -g "$RESOURCE_GROUP" -n "$ENV_NAME" --managed-certificates-only \
    --query "[?properties.subjectName=='$CUSTOM_DOMAIN' && properties.provisioningState=='Succeeded'].name | [0]" -o tsv 2> /dev/null || true)" ]
}
resolve_custom_domain() {
  [ -n "$CUSTOM_DOMAIN" ] || return 0
  if ! command -v dig > /dev/null; then
    echo "WARNING: 'dig' is missing, the DNS check for $CUSTOM_DOMAIN is not possible; deploying without a custom domain." >&2
    return 0
  fi
  local env_domain expected verif_id bound problems=""
  env_domain="$(azq containerapp env show -g "$RESOURCE_GROUP" -n "$ENV_NAME" --query properties.defaultDomain -o tsv | tr 'A-Z' 'a-z')"
  expected="$APP_NAME.$env_domain"
  if app_exists; then
    verif_id="$(azq containerapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --query properties.customDomainVerificationId -o tsv)"
  else
    verif_id="$(azq containerapp env show -g "$RESOURCE_GROUP" -n "$ENV_NAME" --query properties.customDomainConfiguration.customDomainVerificationId -o tsv)"
  fi
  verif_id="$(printf '%s' "$verif_id" | tr 'A-Z' 'a-z')"
  dns_lookup CNAME "$CUSTOM_DOMAIN" | grep -qx "$expected" \
    || problems="${problems}  CNAME  $CUSTOM_DOMAIN  ->  $expected\n"
  [ -n "$verif_id" ] && dns_lookup TXT "asuid.$CUSTOM_DOMAIN" | grep -qx "$verif_id" \
    || problems="${problems}  TXT    asuid.$CUSTOM_DOMAIN  =  $verif_id\n"
  bound="$(domain_binding)"
  if [ -n "$problems" ]; then
    printf 'WARNING: DNS for %s is not ready yet. Missing (or wrong):\n' "$CUSTOM_DOMAIN" >&2
    printf '%b' "$problems" >&2
    if [ -z "$bound" ]; then
      echo "Deploying without a custom domain; run again after setting the records (and DNS propagation)." >&2
      return 0
    fi
    echo "The domain is already bound to the app and stays unchanged (it would be removed otherwise)." >&2
  fi
  DOMAIN="$CUSTOM_DOMAIN"
  if managed_cert_ready; then DOMAIN_STAGE="bind"; else DOMAIN_STAGE="hostname"; fi
  log "Custom domain $DOMAIN: stage '$DOMAIN_STAGE' (CNAME -> $expected, asuid checked)"
}
resolve_custom_domain

# ---------- 2. which image ----------
IMAGE=""
if [ "$INFRA_ONLY" = "1" ]; then
  if app_exists; then
    IMAGE="$(azq containerapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --query 'properties.template.containers[0].image' -o tsv)"
    log "--infra-only: applying the infrastructure with the running image: $IMAGE"
  else
    log "--infra-only: app does not exist yet, done. Then run again without options to build and roll out."
    exit 0
  fi
else
  tag_exists() {
    azq acr repository show-tags -n "$ACR_NAME" --repository "$IMAGE_REPO" -o tsv 2> /dev/null | grep -qx "$1"
  }
  if [ "$SKIP_BUILD" = "1" ]; then
    tag_exists "$TAG" || die "--skip-build: image $IMAGE_REPO:$TAG is not in the registry (run without --skip-build)."
  elif { [ "$DIRTY" = "0" ] || [ -n "${DEPLOY_TAG:-}" ]; } && tag_exists "$TAG"; then
    log "Image $IMAGE_REPO:$TAG is already in the registry, skipping the build"
  else
    log "Building image in Azure (ACR Tasks): $IMAGE_REPO:$TAG"
    # ACR Tasks has no BuildKit: build from the same Dockerfile without the BuildKit-only cache mounts
    ACR_DOCKERFILE=".Dockerfile.acr"
    trap 'rm -f "$ROOT/$ACR_DOCKERFILE"' EXIT
    sed 's/--mount=type=cache,target=[^ ]* //' Dockerfile > "$ACR_DOCKERFILE"
    azq acr build --registry "$ACR_NAME" --image "$IMAGE_REPO:$TAG" --build-arg "BUILD_ID=$TAG" \
      --file "$ACR_DOCKERFILE" . --no-logs > /dev/null || die "az acr build failed (logs: az acr task list-runs -r $ACR_NAME)."
  fi
  IMAGE="$ACR_SERVER/$IMAGE_REPO:$TAG"
fi

# ---------- 3. roll out: blue/green with the writer lease (DESIGN #89) ----------
active_revisions() { azq containerapp revision list -g "$RESOURCE_GROUP" -n "$APP_NAME" --query "[?properties.active].name" -o tsv; }
revision_lease() { # WRITER_LEASE of a revision ('' = a version without the writer lease)
  azq containerapp revision show -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$1" \
    --query "properties.template.containers[0].env[?name=='WRITER_LEASE'].value | [0]" -o tsv 2> /dev/null || true
}
replicas_of() { # fail closed: unknown = still running
  azq containerapp replica list -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$1" --query 'length(@)' -o tsv 2> /dev/null || echo 1
}
stop_revisions() { # deactivate the given revisions and wait until none of their replicas is left
  local rev left n i=0
  [ "$#" -gt 0 ] || return 0
  for rev in "$@"; do
    azq containerapp revision deactivate -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$rev" > /dev/null
  done
  while [ "$i" -lt 40 ]; do
    left=0
    for rev in "$@"; do
      n="$(replicas_of "$rev")"
      left=$((left + ${n:-0}))
    done
    [ "$left" = "0" ] && return 0
    i=$((i + 1))
    sleep 3
  done
  die "Revision(s) $* still running after 2 minutes."
}
revision_fqdn() {
  azq containerapp revision show -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$1" --query properties.fqdn -o tsv 2> /dev/null || true
}
revision_get() { # revision_get <revision> <path>: HTTP status of GET https://<revision fqdn><path> ('' without an fqdn)
  local fqdn
  fqdn="$(revision_fqdn "$1")"
  [ -n "$fqdn" ] || return 0
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://$fqdn$2" || true
}
revision_ready() { # 200 from /api/ready on the revision's own FQDN = this revision holds the writer lease and serves
  [ "$(revision_get "$1" /api/ready)" = "200" ]
}
revision_standby() { # up and answering, lease or not: provisioned, running, replica ready, /api/live 200
  # (never /api/themes or / here: a real request would start the handover before the traffic is shifted, DESIGN #91)
  local prov run ready
  prov="$(azq containerapp revision show -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$1" --query properties.provisioningState -o tsv 2> /dev/null || true)"
  run="$(azq containerapp revision show -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$1" --query properties.runningState -o tsv 2> /dev/null || true)"
  ready="$(azq containerapp replica list -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$1" \
    --query "[?properties.containers[0].ready] | length(@)" -o tsv 2> /dev/null || true)"
  [ "$prov" = "Provisioned" ] || return 1
  case "$run" in Running*) ;; *) return 1 ;; esac
  [ "${ready:-0}" -ge 1 ] 2> /dev/null || return 1
  [ "$(revision_get "$1" /api/live)" = "200" ]
}
wait_for() { # wait_for <check> <revision> <seconds>
  local waited=0
  while [ "$waited" -lt "$3" ]; do
    "$1" "$2" && return 0
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}
wait_ready() { wait_for revision_ready "$1" "$2"; } # wait_ready <revision> <seconds>
shift_traffic() {
  azq containerapp ingress traffic set -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision-weight "$1=100" > /dev/null
}
assert_single_revision() { # single writer: never more than the latest revision active; fix and fail loudly otherwise
  local rev n total=0
  n="$(active_revisions | grep -c . || true)"
  if [ "${n:-0}" -gt 1 ]; then
    echo "WARNING: $n active revisions; deactivating all except $LATEST." >&2
    for rev in $(active_revisions); do
      [ "$rev" = "$LATEST" ] || azq containerapp revision deactivate -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$rev" > /dev/null
    done
  fi
  for rev in $(active_revisions); do
    n="$(replicas_of "$rev")"
    total=$((total + ${n:-0}))
  done
  log "Active revisions: $(active_revisions | tr '\n' ' ')/ total replicas: $total"
  [ "$total" -le 1 ] || die "More than one replica is running after the rollout; please check immediately."
}

OLD=""
if app_exists; then OLD="$(active_revisions | tr '\n' ' ')"; fi
for rev in $OLD; do
  if [ "$(revision_lease "$rev")" != "azure-blob" ]; then
    log "Revision $rev runs without the writer lease: stopping it first (one-time migration, old stop-first rollout)"
    # shellcheck disable=SC2086 # word splitting of the revision list is intended
    stop_revisions $OLD
    OLD=""
    break
  fi
done
TRAFFIC_REVISION="$(printf '%s\n' $OLD | sed -n 1p)"

log "Rolling out app: $IMAGE${TRAFFIC_REVISION:+ (new revision starts with 0 % traffic, $TRAFFIC_REVISION keeps it)}"
deploy_bicep true "$IMAGE"
TRAFFIC_REVISION="" # every later template deployment sends the traffic to the latest revision

LATEST="$(azq containerapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --query 'properties.latestRevisionName' -o tsv)"
if [ "$(azq containerapp revision show -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$LATEST" --query 'properties.active' -o tsv)" != "true" ]; then
  log "Activating revision $LATEST"
  azq containerapp revision activate -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$LATEST" > /dev/null
fi
PREVIOUS=""
for rev in $OLD; do [ "$rev" = "$LATEST" ] || PREVIOUS="$PREVIOUS $rev"; done
logs_hint() { printf 'Logs: az containerapp logs show -g %s -n %s --revision %s --type console --tail 100' "$RESOURCE_GROUP" "$APP_NAME" "$1"; }
first_ready() { # first_ready <revision...>: the first one that holds the lease and serves ('' = none)
  local rev
  for rev in "$@"; do
    if revision_ready "$rev"; then
      printf '%s' "$rev"
      return 0
    fi
  done
}
HANDOVER="none"
if [ -z "$PREVIOUS" ]; then
  log "No other revision to hand over from"
  shift_traffic "$LATEST"
else
  # traffic first (DESIGN #91): the new revision waits in standby and asks for the lease only on its first real request
  log "Waiting until revision $LATEST is up in standby (/api/live)"
  if ! wait_for revision_standby "$LATEST" "$STANDBY_TIMEOUT_SEC"; then
    azq containerapp revision deactivate -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$LATEST" > /dev/null
    die "rollout failed, previous revision kept: $LATEST did not come up within ${STANDBY_TIMEOUT_SEC} s and was deactivated; the traffic stayed on$PREVIOUS. $(logs_hint "$LATEST")"
  fi
  log "Shifting 100 % traffic to $LATEST (still in standby)"
  shift_traffic "$LATEST"
  HANDOVER_START=$SECONDS
  log "Triggering the handover: GET / on $LATEST (HTTP $(revision_get "$LATEST" /))"
  if wait_ready "$LATEST" "$HANDOVER_TIMEOUT_SEC"; then
    log "Revision $LATEST holds the writer lease; handover took $((SECONDS - HANDOVER_START)) s (traffic shift to ready)"
    log "Deactivating the previous revision(s):$PREVIOUS"
    # shellcheck disable=SC2086
    stop_revisions $PREVIOUS
    HANDOVER="blue-green"
  else
    echo "WARNING: revision $LATEST did not take the writer lease over within ${HANDOVER_TIMEOUT_SEC} s." >&2
    # a former holder rejoins after its rejoin delay (2 x lease duration): give it a short while
    # shellcheck disable=SC2086
    KEEP="$(first_ready $PREVIOUS)"
    waited=0
    while [ -z "$KEEP" ] && [ "$waited" -lt "$ROLLBACK_WAIT_SEC" ]; do
      sleep 3
      waited=$((waited + 3))
      # shellcheck disable=SC2086
      KEEP="$(first_ready $PREVIOUS)"
    done
    if [ -n "$KEEP" ]; then
      log "Revision $KEEP holds the writer lease again: shifting the traffic back and deactivating $LATEST"
      shift_traffic "$KEEP"
      stop_revisions "$LATEST"
      die "rollout failed, previous revision kept: $KEEP serves again, $LATEST was deactivated. $(logs_hint "$LATEST")"
    fi
    echo "WARNING: no previous revision is ready either; falling back to stopping the previous revision(s) first (outage until $LATEST holds the lease)." >&2
    # shellcheck disable=SC2086
    stop_revisions $PREVIOUS
    shift_traffic "$LATEST"
    wait_ready "$LATEST" "$HANDOVER_TIMEOUT_SEC" \
      || die "Revision $LATEST did not become ready after the fallback either. $(logs_hint "$LATEST")"
    HANDOVER="fallback"
  fi
fi
assert_single_revision

# ---------- 4. wait until healthy through the public FQDN ----------
FQDN="$(azq containerapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --query 'properties.configuration.ingress.fqdn' -o tsv)"
URL="https://$FQDN"
log "Waiting for $URL/api/ready (revision $LATEST)"
i=0
healthy=0
while [ "$i" -lt 60 ]; do
  state="$(azq containerapp revision show -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$LATEST" --query 'properties.healthState' -o tsv 2> /dev/null || true)"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$URL/api/ready" || true)"
  if [ "$state" = "Healthy" ] && [ "$code" = "200" ]; then
    healthy=1
    break
  fi
  i=$((i + 1))
  sleep 5
done
if [ "$healthy" != "1" ]; then
  echo "Last state: health=$state http=$code" >&2
  die "Revision $LATEST did not become healthy. Logs: az containerapp logs show -g $RESOURCE_GROUP -n $APP_NAME --type console --tail 100"
fi

# ---------- 5. custom domain: managed certificate, then bind it (app-level config, must not add a revision) ----------
DOMAIN_OK=0
if [ -n "$DOMAIN" ]; then
  if [ "$DOMAIN_STAGE" = "hostname" ]; then
    log "Creating managed certificate for $DOMAIN (free, CNAME validation; may take a few minutes)"
    DOMAIN_STAGE="certificate"
    if deploy_bicep true "$IMAGE"; then
      i=0
      cstate=""
      while [ "$i" -lt 120 ]; do # up to 20 minutes
        cstate="$(azq containerapp env certificate list -g "$RESOURCE_GROUP" -n "$ENV_NAME" --managed-certificates-only \
          --query "[?properties.subjectName=='$DOMAIN'].properties.provisioningState | [0]" -o tsv 2> /dev/null || true)"
        case "$cstate" in Succeeded | Failed) break ;; esac
        i=$((i + 1))
        sleep 10
      done
      if [ "$cstate" = "Succeeded" ]; then DOMAIN_STAGE="bind"; fi
    else
      echo "WARNING: The certificate for $DOMAIN could not be created; the app keeps running at $URL." >&2
    fi
    assert_single_revision
  fi
  if [ "$DOMAIN_STAGE" = "bind" ]; then
    log "Binding $DOMAIN with the managed certificate (SniEnabled)"
    if [ "$(domain_binding)" = "SniEnabled" ]; then
      log "$DOMAIN is already bound, nothing to do"
      DOMAIN_OK=1
    elif deploy_bicep true "$IMAGE"; then
      DOMAIN_OK=1
    else
      echo "WARNING: Binding $DOMAIN failed; the app keeps running at $URL." >&2
    fi
    assert_single_revision
  else
    echo "WARNING: Certificate for $DOMAIN is not ready (status '${cstate:-unknown}'); run again later." >&2
  fi
fi

remove_legacy_storage
if [ "$SHARED_KEY_STAGE" = "stage1" ]; then
  log "shared-key removal: stage 1 done, the app mounts the share with the managed identity. Check it (README), then run the script again (e.g. --skip-build) to turn shared-key access off (stage 2)."
fi

log "Done. Image: $IMAGE"
log "Revision: $LATEST (handover: $HANDOVER)"
echo "$URL"
if [ "$DOMAIN_OK" = "1" ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/api/themes" || true)"
  log "Custom domain: https://$DOMAIN (HTTP $code)"
  echo "https://$DOMAIN"
fi
