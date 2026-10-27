// Hochstapler on Azure Container Apps (docs/DESIGN.md #50-#52, writer lease and blue/green rollout: #89).
// Scope: the existing resource group (az deployment group create -g Hochstapler). Names derive from the group id,
// so every re-run addresses the same resources (idempotent). The share is mounted with the account key by default
// (shareAuth 'key', DESIGN #94: the managed-identity mount of #92 could read but not write); the account key is read at
// deployment time for the environment storage definition only. The writer lease uses the app's managed
// identity, logs reach the workspace through diagnostic settings (no workspace key). No secret is ever an output.
targetScope = 'resourceGroup'

@description('Azure region; defaults to the resource group location.')
param location string = resourceGroup().location

@description('Base name of all resources.')
@minLength(3)
@maxLength(12)
param baseName string = 'hochstapler'

@description('false = only the platform (registry, storage, environment, identity); the app needs an image in the registry first.')
param deployApp bool = true

@description('Image reference (registry/repository:tag) of the app. Only used when deployApp is true.')
param image string = ''

@description('BUILD_ID baked into the image; informational label on the revision (the client reloads on a new id).')
param buildId string = ''

@description('Log retention in days (cost).')
@minValue(30)
@maxValue(730)
param logRetentionDays int = 30

@description('Daily ingestion cap of the Log Analytics workspace in GB (cost protection).')
param logDailyCapGb string = '0.1'

@description('Soft delete retention of the Azure Files share in days (backup safety net).')
@minValue(1)
@maxValue(365)
param shareSoftDeleteDays int = 14

@description('Quota of the data file share in GiB (billing is per used GiB).')
param shareQuotaGiB int = 5

@description('DATA_DIR inside the mounted share (the share is always mounted at /data). Only change it to start from another database file, e.g. a restored backup in a subfolder (see README).')
param dataDir string = '/data'

@description('Optional extra browser origins allowed to call the API (comma-separated, see ALLOWED_ORIGINS). Normally empty (same origin).')
param allowedOrigins string = ''

@description('OpenTelemetry (DESIGN #56): workspace-based Application Insights plus the Container Apps managed OpenTelemetry agent, which injects OTEL_EXPORTER_OTLP_ENDPOINT into the app. false = no telemetry resources and no OTEL_* variables (the app then loads no SDK).')
param enableTelemetry bool = true

@description('Share of traces kept (OTEL_TRACES_SAMPLER=parentbased_traceidratio). Ingestion is capped by the workspace daily quota anyway.')
param traceSampleRatio string = '0.2'

@description('Optional custom domain (e.g. game.example.com). Needs DNS first: CNAME -> the app FQDN and TXT asuid.<domain> = customDomainVerificationId (README). Empty = default azurecontainerapps.io domain only.')
param customDomain string = ''

@allowed(['hostname', 'certificate', 'bind'])
@description('Custom domain stage (chicken-and-egg: the managed certificate can only be issued for a hostname that is already on the app, and the binding needs the certificate). hostname = hostname on the app without TLS binding; certificate = like hostname plus the managed certificate; bind = hostname bound with SniEnabled and the existing certificate. scripts/azure-deploy.sh drives the stages; an unchanged stage is a no-op (no new revision, no new certificate).')
param customDomainStage string = 'hostname'

@allowed(['key', 'identity'])
@description('How the environment mounts the Azure Files share (DESIGN #94). key (default) = key-based storage definition hochstapler-data, shared-key access and NTLMv2 on. identity = managed-identity definition hochstapler-data-mi (DESIGN #92, preview; live it could read but not write, so it is opt-in until that is understood). scripts/azure-deploy.sh passes AZ_SHARE_AUTH.')
param shareAuth string = 'key'

@description('identity only: shared-key (account key) access to the storage account. false = Entra ID only (DESIGN #92). true only in the migration stage: scripts/azure-deploy.sh sets it while an active revision still mounts the share through the key-based storage definition, or when AZ_ALLOW_SHARED_KEY=1. Ignored with shareAuth key (always on there).')
param allowSharedKeyAccess bool = false

@description('Blue/green rollout (DESIGN #89): name of the running revision that keeps 100 % of the traffic while a new revision starts with 0 % in standby; scripts/azure-deploy.sh then shifts the traffic, and the first request makes the new revision take the writer lease over (DESIGN #91). Empty = the latest revision gets all traffic.')
param trafficRevision string = ''

var suffix = uniqueString(resourceGroup().id)
var storageName = take('st${baseName}${suffix}', 24) // 3-24 chars, lowercase letters/digits
var registryName = 'cr${baseName}${suffix}' // 5-50 chars, alphanumeric
var shareName = 'data'
// two environment storage definitions, one per shareAuth mode (DESIGN #94); only the selected one is deployed, the other
// one stays as it is in Azure (incremental deployment). The key-based one is removed by scripts/azure-deploy.sh only in
// identity mode, stage 2 (DESIGN #92), never in key mode.
var useKey = shareAuth == 'key'
var sharedKeyOn = useKey || allowSharedKeyAccess
var keyStorageName = 'hochstapler-data'
var miStorageName = 'hochstapler-data-mi'
var envStorageName = useKey ? keyStorageName : miStorageName
var port = 8787
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d' // built-in "AcrPull"
var blobContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe' // built-in "Storage Blob Data Contributor"
var smbMiAdminRoleId = 'a235d3ee-5935-4cfb-8cc5-a3303ad5995e' // built-in "Storage File Data SMB MI Admin"
var leaseContainerName = 'leases'

// ---------- logs: 30 days, small daily cap ----------
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${baseName}-${suffix}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: logRetentionDays
    workspaceCapping: { dailyQuotaGb: json(logDailyCapGb) }
    features: { disableLocalAuth: false }
  }
}

// ---------- Application Insights (workspace-based: data is stored in, billed by and capped with the workspace above) ----------
resource appInsights 'Microsoft.Insights/components@2020-02-02' = if (enableTelemetry) {
  name: 'appi-${baseName}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    IngestionMode: 'LogAnalytics'
    DisableLocalAuth: false // the managed OpenTelemetry agent authenticates with the instrumentation key (not a secret, see docs)
    RetentionInDays: logRetentionDays
  }
}

// ---------- storage: Azure Files share for the SQLite database (/data) ----------
resource storage 'Microsoft.Storage/storageAccounts@2025-06-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: sharedKeyOn // key mode: the mount needs it; identity mode: false = Entra ID only (DESIGN #92)
    allowCrossTenantReplication: false
    publicNetworkAccess: 'Enabled'
    networkAcls: { defaultAction: 'Allow', bypass: 'AzureServices' }
    // Managed Identity for SMB (SMBOAuth): in identity mode the Container Apps environment mounts the share with an Entra
    // token of its identity instead of the account key. Kept on in key mode too (harmless; needed to investigate #94).
    // 'None' = no AD DS / Entra Kerberos for user identities.
    azureFilesIdentityBasedAuthentication: {
      directoryServiceOptions: 'None'
      smbOAuthSettings: { isSmbOAuthEnabled: true }
    }
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2025-06-01' = {
  parent: storage
  name: 'default'
  properties: {
    shareDeleteRetentionPolicy: { enabled: true, days: shareSoftDeleteDays }
    // SMB OAuth needs Kerberos; NTLMv2 is the account-key path and stays allowed exactly while the key is
    protocolSettings: { smb: { authenticationMethods: sharedKeyOn ? 'NTLMv2;Kerberos' : 'Kerberos' } }
  }
}

resource share 'Microsoft.Storage/storageAccounts/fileServices/shares@2025-06-01' = {
  parent: fileService
  name: shareName
  properties: {
    shareQuota: shareQuotaGiB
    enabledProtocols: 'SMB'
    accessTier: 'TransactionOptimized'
  }
}

// ---------- writer lease (DESIGN #89): one blob in a private container, leased by the app's managed identity ----------
// Only the lease holder opens the SQLite file. Access is Entra ID (managed identity token) with a role scoped to this one
// container: no account key, no SAS. The account is StorageV2 (above), so blob and file services share it.
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-06-01' = {
  parent: storage
  name: 'default'
}

resource leaseContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-06-01' = {
  parent: blobService
  name: leaseContainerName
  properties: {
    publicAccess: 'None'
  }
}

// ---------- registry (Basic, no admin user) + pull identity ----------
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource pullIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${baseName}-pull'
  location: location
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, pullIdentity.id, acrPullRoleId)
  properties: {
    principalId: pullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

// The app's (only) user-assigned identity may read/write blobs of the lease container, nothing else in the account.
resource leaseRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: leaseContainer
  name: guid(leaseContainer.id, pullIdentity.id, blobContributorRoleId)
  properties: {
    principalId: pullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobContributorRoleId)
  }
}

// The environment carries the same identity and, in identity mode, mounts the share with it (DESIGN #92). Kept in key
// mode for the investigation of #94. Storage account scope as the Container Apps docs require; the role holds file data
// actions only, so the lease container stays untouched by it.
resource shareMountRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, pullIdentity.id, smbMiAdminRoleId)
  properties: {
    principalId: pullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', smbMiAdminRoleId)
  }
}

// ---------- environment (consumption only) ----------
// 2026-07-01 (not 2025-01-01) because only this version and the preview ones know openTelemetryConfiguration (#56).
resource environment 'Microsoft.App/managedEnvironments@2026-07-01' = {
  name: 'cae-${baseName}'
  location: location
  // used for the identity-mode Azure Files mount only (envStorageMi); image pulls and the writer lease use the app's identity
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${pullIdentity.id}': {} }
  }
  properties: {
    // logs go to the workspace through diagnostic settings (envLogs), not with the workspace shared key (DESIGN #92)
    appLogsConfiguration: {
      destination: 'azure-monitor'
    }
    zoneRedundant: false
    // Managed OpenTelemetry agent: gRPC only; Application Insights accepts traces and logs, NOT metrics (docs: known limitations).
    appInsightsConfiguration: enableTelemetry ? { connectionString: appInsights!.properties.ConnectionString } : null
    openTelemetryConfiguration: enableTelemetry
      ? {
          tracesConfiguration: { destinations: ['appInsights'] }
          logsConfiguration: { destinations: ['appInsights'] }
        }
      : null
  }
}

// Console and system logs into the workspace (resource-specific tables ContainerAppConsoleLogs / ContainerAppSystemLogs).
// Never ContainerAppHTTPLogs: they carry client addresses and raw URLs.
resource envLogs 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: environment
  name: 'logs-to-workspace'
  properties: {
    workspaceId: logs.id
    logAnalyticsDestinationType: 'Dedicated'
    logs: [
      { category: 'ContainerAppConsoleLogs', enabled: true }
      { category: 'ContainerAppSystemLogs', enabled: true }
    ]
  }
}

// Key mode (default, DESIGN #94): the definition every revision before #92 mounted, unchanged (same name, same key), so a
// rollout leaves a running key-mount revision's definition as it is. The key is read here only, at deployment time.
resource envStorageKey 'Microsoft.App/managedEnvironments/storages@2025-01-01' = if (useKey) {
  parent: environment
  name: keyStorageName
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: share.name
      accessMode: 'ReadWrite'
    }
  }
}

// Identity mode: managed-identity mount (DESIGN #92). PREVIEW: azureFile.identity exists only in 2026-03-02-preview (not
// in the GA 2026-07-01); if the preview changes or goes away, see DESIGN #92 for the fallback. The identity must be on
// the environment and hold the role above; dependsOn orders the deployment but does not wait for RBAC propagation (a
// mount that fails because of it makes the new revision miss its standby check, the deploy script then keeps the old
// one). Live, this mount could read but every write failed (DESIGN #94); the write self-test now keeps such a revision
// from going ready.
resource envStorageMi 'Microsoft.App/managedEnvironments/storages@2026-03-02-preview' = if (!useKey) {
  parent: environment
  name: miStorageName
  properties: {
    azureFile: {
      accountName: storage.name
      identity: pullIdentity.id
      shareName: share.name
      accessMode: 'ReadWrite'
    }
  }
  dependsOn: [shareMountRole]
}

// ---------- the app ----------
var appEnv = concat(
  [
    { name: 'NODE_ENV', value: 'production' }
    { name: 'HTTPS_ONLY', value: '1' } // the ingress terminates TLS; HSTS + upgrade-insecure-requests on every response
    { name: 'DATA_DIR', value: dataDir }
    { name: 'PORT', value: string(port) }
    // The ingress (Envoy) appends the client address to x-forwarded-for; only that rightmost entry is trusted (docs: "Only the
    // rightmost IP is provided by Azure Container Apps"). Used for per-client rate limits, never logged (DESIGN #59).
    { name: 'TRUST_PROXY_HOPS', value: '1' }
    // SMB: no WAL (needs shared memory), rollback journal instead (DESIGN #51)
    { name: 'SQLITE_JOURNAL_MODE', value: 'delete' }
    // writer lease (DESIGN #89): only the holder of the blob lease opens the database; token from the managed identity
    // (Container Apps sets IDENTITY_ENDPOINT / IDENTITY_HEADER; AZURE_CLIENT_ID selects the user-assigned identity)
    { name: 'WRITER_LEASE', value: 'azure-blob' }
    { name: 'WRITER_LEASE_ACCOUNT_URL', value: storage.properties.primaryEndpoints.blob }
    { name: 'WRITER_LEASE_CONTAINER', value: leaseContainerName }
    { name: 'AZURE_CLIENT_ID', value: pullIdentity.properties.clientId }
    // a new revision asks the running one to hand over only on its first real request (DESIGN #91): the deploy script
    // shifts the traffic to it first, so the players' gap is the handover itself
    { name: 'WRITER_LEASE_HANDOVER', value: 'on-traffic' }
  ],
  empty(allowedOrigins) ? [] : [{ name: 'ALLOWED_ORIGINS', value: allowedOrigins }],
  // OTEL_EXPORTER_OTLP_ENDPOINT / _PROTOCOL (grpc) / OTEL_RESOURCE_ATTRIBUTES are injected by the managed agent. The rest
  // is ours: sample 20 % of the traces (parent-based), no metrics (App Insights cannot take them from the agent), logs on (warn/error and a few info records, DESIGN #73; the agent routes them to App Insights via logsConfiguration).
  enableTelemetry
    ? [
        { name: 'OTEL_SERVICE_NAME', value: baseName }
        { name: 'OTEL_TRACES_SAMPLER', value: 'parentbased_traceidratio' }
        { name: 'OTEL_TRACES_SAMPLER_ARG', value: traceSampleRatio }
        { name: 'OTEL_METRICS_EXPORTER', value: 'none' }
        { name: 'OTEL_LOGS_EXPORTER', value: 'otlp' }
      ]
    : []
)

var hasDomain = !empty(customDomain)
var certName = take('mc-${replace(customDomain, '.', '-')}', 60)
// built from names (not cert.id) so the app does not depend on the certificate, which in turn depends on the app
var certId = resourceId('Microsoft.App/managedEnvironments/managedCertificates', environment.name, certName)
var customDomains = !hasDomain ? null : [
  customDomainStage == 'bind'
    ? { name: customDomain, bindingType: 'SniEnabled', certificateId: certId }
    : { name: customDomain, bindingType: 'Disabled' }
]

var probePath = '/api/themes' // liveness/startup: same endpoint as the Dockerfile HEALTHCHECK, answers in standby too
// readiness: up and answering, in standby too (DESIGN #91): the traffic must reach a new revision before it holds the lease
// (its first real request starts the handover). /api/ready (= holds the lease) is for the deploy script, not the platform.
var readyPath = '/api/live'

resource app 'Microsoft.App/containerApps@2025-01-01' = if (deployApp) {
  name: baseName
  location: location
  tags: { buildId: buildId }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${pullIdentity.id}': {} }
  }
  dependsOn: [acrPull, leaseRole, envStorageKey, envStorageMi]
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: null
    configuration: {
      // Multiple (not Single!): in Single mode the platform starts and stops revisions on its own (#52). Two revisions may
      // run at the same time now, but only the holder of the writer lease opens the SQLite file (#89): the new revision
      // starts with 0 % traffic (trafficRevision) in standby, scripts/azure-deploy.sh shifts the traffic to it, its first
      // request takes the lease over (#91), then the script deactivates the old one. Never deploy this template without
      // that script.
      activeRevisionsMode: 'Multiple'
      maxInactiveRevisions: 3
      ingress: {
        external: true
        targetPort: port
        transport: 'auto' // HTTP/1.1 + WebSocket upgrade
        allowInsecure: false // http -> https redirect at the edge
        traffic: empty(trafficRevision)
          ? [{ latestRevision: true, weight: 100 }]
          : [{ revisionName: trafficRevision, weight: 100 }]
        customDomains: customDomains // app-level ingress config, creates no revision
      }
      registries: [{ server: registry.properties.loginServer, identity: pullIdentity.id }]
    }
    template: {
      terminationGracePeriodSeconds: 20 // app: SIGTERM -> persist + close(1012), hard exit after 5 s (#44)
      containers: [
        {
          name: 'app'
          image: image
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: appEnv
          volumeMounts: [{ volumeName: 'data', mountPath: '/data' }]
          probes: [
            {
              type: 'Startup'
              httpGet: { path: probePath, port: port }
              periodSeconds: 3
              failureThreshold: 20
              timeoutSeconds: 3
            }
            {
              type: 'Liveness'
              httpGet: { path: probePath, port: port }
              periodSeconds: 30
              failureThreshold: 3
              timeoutSeconds: 5
            }
            {
              type: 'Readiness'
              httpGet: { path: readyPath, port: port }
              periodSeconds: 10
              failureThreshold: 3
              timeoutSeconds: 5
            }
          ]
        }
      ]
      // stateful + authoritative: exactly one replica per revision, never scaled (the lease decides who writes)
      scale: { minReplicas: 1, maxReplicas: 1 }
      volumes: [
        {
          name: 'data'
          storageType: 'AzureFile'
          storageName: envStorageName
          // uid/gid = the image's non-root user. nobrl: no SMB byte-range locks (they are mandatory on the server and make
          // SQLite hang with "database is locked"); safe ONLY because exactly one process opens the file (#51/#52).
          mountOptions: 'uid=1000,gid=1000,dir_mode=0770,file_mode=0660,nobrl,mfsymlinks,cache=strict'
        }
      ]
    }
  }
}

// Free managed certificate (CNAME validation). Only in stage 'certificate': stage 'bind' neither re-validates nor re-creates it.
resource managedCert 'Microsoft.App/managedEnvironments/managedCertificates@2025-01-01' = if (deployApp && hasDomain && customDomainStage == 'certificate') {
  parent: environment
  name: certName
  location: location
  properties: {
    subjectName: customDomain
    domainControlValidation: 'CNAME'
  }
  dependsOn: [app]
}

output registryName string = registry.name
output registryLoginServer string = registry.properties.loginServer
output environmentName string = environment.name
output appName string = baseName
output storageAccountName string = storage.name
output shareName string = share.name
output logWorkspaceName string = logs.name
output appInsightsName string = enableTelemetry ? appInsights!.name : ''
output fqdn string = deployApp ? app!.properties.configuration.ingress.fqdn : ''
