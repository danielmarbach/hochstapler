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
# Update strategy (#52): the app holds games in memory, runs bot/turn timers and writes ONE SQLite file on Azure Files
# (mounted with `nobrl`, no byte-range locks). Two server processes on that file would corrupt state. Container Apps
# starts the new revision before it stops the old one, so this script DEACTIVATES the running revision first (SIGTERM ->
# games are persisted, clients get 1012 and reconnect) and only then rolls out the new one: ~30-60 s downtime.
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
      sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
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
    -o none
}
app_exists() { az containerapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --only-show-errors > /dev/null 2>&1; }

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

# ---------- 3. roll out: stop the old revision FIRST (single writer on the SQLite file) ----------
if app_exists; then
  ACTIVE="$(azq containerapp revision list -g "$RESOURCE_GROUP" -n "$APP_NAME" --query "[?properties.active].name" -o tsv)"
  if [ -n "$ACTIVE" ]; then
    log "Stopping the running revision before the rollout (never two processes on the same SQLite file)"
    for rev in $ACTIVE; do
      azq containerapp revision deactivate -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$rev" > /dev/null
    done
    # wait until no replica of the old revision is left
    i=0
    while [ "$i" -lt 40 ]; do
      left=0
      for rev in $ACTIVE; do
        n="$(azq containerapp replica list -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$rev" --query 'length(@)' -o tsv 2> /dev/null || echo 1)" # fail closed: unknown = still running
        left=$((left + ${n:-0}))
      done
      [ "$left" = "0" ] && break
      i=$((i + 1))
      sleep 3
    done
    [ "$left" = "0" ] || die "Old revision still running after 2 minutes; aborting before a second process starts."
  fi
fi

log "Rolling out app: $IMAGE"
deploy_bicep true "$IMAGE"

# unchanged template => no new revision was created; the (deactivated) latest one has to be started again
LATEST="$(azq containerapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --query 'properties.latestRevisionName' -o tsv)"
if [ "$(azq containerapp revision show -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$LATEST" --query 'properties.active' -o tsv)" != "true" ]; then
  log "Activating revision $LATEST"
  azq containerapp revision activate -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$LATEST" > /dev/null
fi

# ---------- 4. wait until healthy ----------
FQDN="$(azq containerapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --query 'properties.configuration.ingress.fqdn' -o tsv)"
URL="https://$FQDN"
log "Waiting for $URL/api/themes (revision $LATEST)"
i=0
healthy=0
while [ "$i" -lt 60 ]; do
  state="$(azq containerapp revision show -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$LATEST" --query 'properties.healthState' -o tsv 2> /dev/null || true)"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$URL/api/themes" || true)"
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
active_revisions() { azq containerapp revision list -g "$RESOURCE_GROUP" -n "$APP_NAME" --query "[?properties.active].name" -o tsv; }
assert_single_revision() { # single writer (#52): never more than the latest revision active; fix and fail loudly otherwise
  local rev n total=0
  n="$(active_revisions | grep -c . || true)"
  if [ "${n:-0}" -gt 1 ]; then
    echo "WARNING: $n active revisions after the domain step; deactivating all except $LATEST." >&2
    for rev in $(active_revisions); do
      [ "$rev" = "$LATEST" ] || azq containerapp revision deactivate -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$rev" > /dev/null
    done
  fi
  for rev in $(active_revisions); do
    n="$(azq containerapp replica list -g "$RESOURCE_GROUP" -n "$APP_NAME" --revision "$rev" --query 'length(@)' -o tsv 2> /dev/null || echo 1)"
    total=$((total + ${n:-0}))
  done
  log "Active revisions: $(active_revisions | tr '\n' ' ')/ total replicas: $total"
  [ "$total" -le 1 ] || die "More than one replica is running (see DESIGN #52); please check immediately."
}
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

log "Done. Image: $IMAGE"
log "Revision: $LATEST"
echo "$URL"
if [ "$DOMAIN_OK" = "1" ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/api/themes" || true)"
  log "Custom domain: https://$DOMAIN (HTTP $code)"
  echo "https://$DOMAIN"
fi
