// Deployment files must keep the hardening (docs/DESIGN.md #46): Caddy repeats the app's headers, the containers stay
// locked down, and the app is never published directly in the production compose file.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { HSTS, PERMISSIONS_POLICY, buildCsp } from "../src/security.ts";

const repo = resolve(import.meta.dirname, "../../..");
const read = (rel: string): string => readFileSync(resolve(repo, rel), "utf8");

interface Service {
  read_only?: boolean;
  user?: string;
  cap_drop?: string[];
  cap_add?: string[];
  security_opt?: string[];
  pids_limit?: number;
  mem_limit?: string;
  ports?: string[];
  tmpfs?: string[];
}
const services = (rel: string): Record<string, Service> =>
  (parse(read(rel)) as { services: Record<string, Service> }).services;

describe("deploy/Caddyfile", () => {
  const caddy = read("deploy/Caddyfile");
  it("repeats exactly the headers the app sends (HTTPS mode)", () => {
    expect(caddy).toContain(`Content-Security-Policy "${buildCsp(true)}"`);
    expect(caddy).toContain(`Permissions-Policy "${PERMISSIONS_POLICY}"`);
    expect(caddy).toContain(`Strict-Transport-Security "${HSTS}"`);
    for (const h of [
      'X-Content-Type-Options "nosniff"',
      'Referrer-Policy "no-referrer"',
      'Cross-Origin-Opener-Policy "same-origin"',
      'Cross-Origin-Resource-Policy "same-origin"',
      'X-Frame-Options "DENY"',
      "-Server",
    ]) {
      expect(caddy).toContain(h);
    }
  });
  it("blocks test-mode routes, dotfiles and unwanted methods, limits bodies, hides query strings", () => {
    expect(caddy).toMatch(/path \/api\/test \/api\/test\/\*\s+respond @testmode 404/s);
    expect(caddy).toContain("@dotfiles path_regexp");
    expect(caddy).toContain("not method GET HEAD POST PATCH DELETE");
    expect(caddy).toContain("max_size 64KB");
    expect(caddy).toContain('request>uri regexp \\?.* ""');
    expect(caddy).toContain("request>headers>X-Player-Token delete");
  });
});

describe("trusted proxy hops (DESIGN #59)", () => {
  it("every public deployment declares exactly one trusted hop and Caddy overwrites x-forwarded-for", () => {
    expect(read("infra/main.bicep")).toContain("{ name: 'TRUST_PROXY_HOPS', value: '1' }");
    const env = (
      parse(read("deploy/compose.prod.yaml")) as {
        services: { app: { environment: Record<string, string> } };
      }
    ).services.app.environment;
    expect(env["TRUST_PROXY_HOPS"]).toBe("1");
    expect(read("deploy/Caddyfile")).toContain("header_up X-Forwarded-For {remote_host}");
  });
  it("the LAN compose file trusts no proxy (default 0)", () => {
    expect(read("compose.yaml")).not.toContain("TRUST_PROXY_HOPS");
  });
  it("compose deployments use the file writer lease on their local volume (DESIGN #89)", () => {
    for (const [file, service] of [
      ["compose.yaml", "hochstapler"],
      ["deploy/compose.prod.yaml", "app"],
    ] as const) {
      const env = (
        parse(read(file)) as { services: Record<string, { environment: Record<string, string> }> }
      ).services[service]?.environment;
      expect(env?.["WRITER_LEASE"], file).toBe("file");
    }
  });
});

describe("compose files", () => {
  for (const file of ["compose.yaml", "deploy/compose.prod.yaml"]) {
    for (const [name, svc] of Object.entries(services(file))) {
      it(`${file}: ${name} is locked down`, () => {
        expect(svc.read_only).toBe(true);
        expect(svc.cap_drop).toEqual(["ALL"]);
        expect(svc.security_opt).toContain("no-new-privileges:true");
        expect(svc.pids_limit).toBeGreaterThan(0);
        expect(svc.mem_limit).toBeTruthy();
        expect(svc.tmpfs?.some((t) => t.startsWith("/tmp"))).toBe(true);
        if (name !== "caddy") {
          expect(svc.user).toBe("1000:1000");
          expect(svc.cap_add).toBeUndefined();
        }
      });
    }
  }
  it("production: only Caddy publishes ports (80/443) and may bind low ports", () => {
    const { app, caddy } = services("deploy/compose.prod.yaml");
    expect(app?.ports).toBeUndefined();
    expect(caddy?.ports).toEqual(["80:80", "443:443", "443:443/udp"]);
    expect(caddy?.cap_add).toEqual(["NET_BIND_SERVICE"]);
  });
});

describe("Dockerfile", () => {
  const docker = read("Dockerfile");
  it("pins the base image by digest, runs non-root and keeps the healthcheck", () => {
    expect(docker).toMatch(
      /^ARG NODE_IMAGE=node:\d+\.\d+\.\d+-bookworm-slim@sha256:[0-9a-f]{64}$/m,
    );
    expect(docker).toMatch(/^USER 1000:1000$/m);
    expect(docker).toContain("HEALTHCHECK");
    expect(docker).toContain("npm ci --omit=dev");
  });

  it("copies the workspace-nested production dependencies into the runtime image", () => {
    // npm keeps packages with (optional) peer dependencies, e.g. altcha-lib, in packages/server/node_modules; the
    // runtime stage copies only what it names, so a nested dependency that is not copied is missing in production
    const lock = z
      .object({ packages: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(read("package-lock.json")));
    const nested = Object.keys(lock.packages).filter((k) =>
      k.startsWith("packages/server/node_modules/"),
    );
    if (nested.length > 0) {
      expect(docker).toContain(
        "COPY --from=deps /app/packages/server/node_modules packages/server/node_modules",
      );
    }
  });
});

describe("infra/main.bicep (Azure Container Apps, DESIGN #50-#52)", () => {
  const bicep = read("infra/main.bicep");
  it("keeps the single-writer and hardening settings", () => {
    expect(bicep).toContain("activeRevisionsMode: 'Multiple'");
    expect(bicep).toContain("scale: { minReplicas: 1, maxReplicas: 1 }");
    expect(bicep).toContain("allowInsecure: false");
    expect(bicep).toContain("adminUserEnabled: false");
    expect(bicep).toContain("minimumTlsVersion: 'TLS1_2'");
    expect(bicep).toContain("allowBlobPublicAccess: false");
    expect(bicep).toMatch(/mountOptions: '[^']*\buid=1000,gid=1000\b/);
    expect(bicep).toMatch(/mountOptions: '[^']*\bnobrl\b/);
    expect(bicep).toContain("{ name: 'SQLITE_JOURNAL_MODE', value: 'delete' }");
    // the managed-identity mount ignores nobrl: SQLite takes no file locks, the writer lease guards (DESIGN #95)
    expect(bicep).toContain("{ name: 'SQLITE_LOCKING', value: 'none' }");
    expect(bicep).toContain("{ name: 'HTTPS_ONLY', value: '1' }");
  });
  it("never enables test mode and never outputs secrets", () => {
    expect(bicep).not.toContain("POLY_TEST_MODE");
    for (const line of bicep.split("\n").filter((l) => l.startsWith("output "))) {
      expect(line).not.toMatch(/key|secret|password|listKeys/i);
    }
  });
  it("custom domain is optional, staged and uses a free managed certificate", () => {
    expect(bicep).toContain("param customDomain string = ''");
    expect(bicep).toMatch(
      /@allowed\(\['hostname', 'certificate', 'bind'\]\)\s*@description\([^\n]*\)\s*param customDomainStage string = 'hostname'/,
    );
    expect(bicep).toContain("Microsoft.App/managedEnvironments/managedCertificates@");
    expect(bicep).toContain("domainControlValidation: 'CNAME'");
    expect(bicep).toContain("bindingType: 'SniEnabled'");
    expect(bicep).toContain("bindingType: 'Disabled'");
    expect(bicep).toContain("certificateId: certId");
    // no domain => no customDomains on the ingress and no certificate (template unchanged)
    expect(bicep).toContain("var customDomains = !hasDomain ? null");
    expect(bicep).toMatch(
      /managedCert[^\n]*= if \(deployApp && hasDomain && customDomainStage == 'certificate'\)/,
    );
    // the real domain is configuration, never hard-coded in the template or its parameters
    expect(bicep).not.toMatch(/openplace/);
    expect(read("infra/main.bicepparam")).not.toMatch(/customDomain/);
    expect(read("infra/main.bicepparam")).toContain("param dataDir = '/data/v2'");
  });
  it("deploy script checks DNS first, never fails the deploy for the domain and guards the single writer", () => {
    const script = read("scripts/azure-deploy.sh");
    expect(script).toContain("AZ_CUSTOM_DOMAIN");
    expect(script).toContain("asuid.");
    expect(script).toContain("customDomainVerificationId");
    expect(script).toContain("assert_single_revision");
    expect(read(".env.azure.example")).toContain("# AZ_CUSTOM_DOMAIN=game.example.com");
  });
});

describe("telemetry deployment (DESIGN #54)", () => {
  const bicep = read("infra/main.bicep");
  it("routes traces through the managed agent into a workspace-based Application Insights and samples", () => {
    expect(bicep).toContain("WorkspaceResourceId: logs.id");
    expect(bicep).toContain("IngestionMode: 'LogAnalytics'");
    expect(bicep).toContain("tracesConfiguration: { destinations: ['appInsights'] }");
    expect(bicep).toContain("{ name: 'OTEL_TRACES_SAMPLER', value: 'parentbased_traceidratio' }");
    expect(bicep).toContain("param traceSampleRatio string = '0.2'");
    // the cost cap of the workspace stays in place
    expect(bicep).toContain("workspaceCapping: { dailyQuotaGb: json(logDailyCapGb) }");
    // the connection string is never an output
    expect(bicep).not.toMatch(/output .*(ConnectionString|InstrumentationKey)/i);
  });
  it("compose.yaml has no telemetry dashboard any more: local telemetry is the Aspire AppHost (DESIGN #71)", () => {
    expect(Object.keys(services("compose.yaml"))).toEqual(["hochstapler"]);
  });
});

describe("writer lease on Azure (DESIGN #89)", () => {
  const bicep = read("infra/main.bicep");
  it("leases one blob in a private container of the StorageV2 account", () => {
    expect(bicep).toContain("kind: 'StorageV2'");
    expect(bicep).toContain("Microsoft.Storage/storageAccounts/blobServices/containers@");
    expect(bicep).toContain("var leaseContainerName = 'leases'");
    expect(bicep).toMatch(/resource leaseContainer [^\n]*\n[^}]*publicAccess: 'None'/);
  });
  it("grants Storage Blob Data Contributor to the app identity on that container only, no keys or SAS", () => {
    expect(bicep).toContain("var blobContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'");
    expect(bicep).toMatch(
      /resource leaseRole 'Microsoft\.Authorization\/roleAssignments@[^']+' = \{\s*scope: leaseContainer\s/,
    );
    expect(bicep).toMatch(
      /resource leaseRole[\s\S]*?principalId: pullIdentity\.properties\.principalId/,
    );
    expect(bicep).toContain("dependsOn: [acrPull, leaseRole, envStorageKey, envStorageMi]");
    expect(bicep).not.toMatch(/listAccountSas|listServiceSas/);
    // the lease settings are plain values: an endpoint URL and names, never a key
    for (const line of bicep.split("\n").filter((l) => /WRITER_LEASE|AZURE_CLIENT_ID/.test(l))) {
      expect(line).not.toMatch(/listKeys|key|sas|secret/i);
    }
  });
  it("configures the app for the blob lease with the user-assigned identity", () => {
    expect(bicep).toContain("{ name: 'WRITER_LEASE', value: 'azure-blob' }");
    expect(bicep).toContain(
      "{ name: 'WRITER_LEASE_ACCOUNT_URL', value: storage.properties.primaryEndpoints.blob }",
    );
    expect(bicep).toContain("{ name: 'WRITER_LEASE_CONTAINER', value: leaseContainerName }");
    expect(bicep).toContain("{ name: 'AZURE_CLIENT_ID', value: pullIdentity.properties.clientId }");
  });
  it("hands over on traffic: the deploy script shifts the traffic first (DESIGN #91)", () => {
    expect(bicep).toContain("{ name: 'WRITER_LEASE_HANDOVER', value: 'on-traffic' }");
  });
  it("readiness, liveness and startup all work in standby (traffic reaches a new revision before it holds the lease)", () => {
    expect(bicep).toContain("var readyPath = '/api/live'");
    expect(bicep).toContain("var probePath = '/api/themes'");
    expect(bicep).toMatch(/type: 'Readiness'\s*httpGet: \{ path: readyPath, port: port \}/);
    expect(bicep).toMatch(/type: 'Liveness'\s*httpGet: \{ path: probePath, port: port \}/);
    expect(bicep).toMatch(/type: 'Startup'\s*httpGet: \{ path: probePath, port: port \}/);
  });
  it("a new revision can start with 0 % traffic while the running one keeps it", () => {
    expect(bicep).toContain("param trafficRevision string = ''");
    expect(bicep).toContain("[{ revisionName: trafficRevision, weight: 100 }]");
    expect(bicep).toContain("[{ latestRevision: true, weight: 100 }]");
  });
});

describe("share authentication on Azure: account key by default, managed identity opt-in (DESIGN #92, #94)", () => {
  const bicep = read("infra/main.bicep");
  const resource = (name: string): string => {
    const start = bicep.indexOf(`resource ${name} `);
    expect(start).toBeGreaterThan(-1);
    return bicep.slice(start, bicep.indexOf("\n}\n", start));
  };
  it("selects the share authentication with a parameter that defaults to the account key", () => {
    expect(bicep).toMatch(
      /@allowed\(\['key', 'identity'\]\)\s*@description\([^\n]*\)\s*param shareAuth string = 'key'/,
    );
    expect(bicep).toContain("var useKey = shareAuth == 'key'");
    expect(read("infra/main.bicepparam")).not.toMatch(/shareAuth|allowSharedKeyAccess/);
  });
  it("key: shared-key access and NTLMv2 on; identity: only while the deploy script's migration stage asks for it", () => {
    expect(bicep).toContain("param allowSharedKeyAccess bool = false");
    expect(bicep).toContain("var sharedKeyOn = useKey || allowSharedKeyAccess");
    expect(resource("storage")).toContain("allowSharedKeyAccess: sharedKeyOn");
    expect(resource("fileService")).toContain(
      "protocolSettings: { smb: { authenticationMethods: sharedKeyOn ? 'NTLMv2;Kerberos' : 'Kerberos' } }",
    );
  });
  it("key: the key-based storage definition hochstapler-data (GA API), the account key read only for it", () => {
    const keyStorage = resource("envStorageKey");
    expect(keyStorage).toMatch(
      /^resource envStorageKey 'Microsoft\.App\/managedEnvironments\/storages@2025-01-01' = if \(useKey\) \{/,
    );
    expect(keyStorage).toContain("name: keyStorageName");
    expect(keyStorage).toMatch(
      /azureFile: \{\s*accountName: storage\.name\s*accountKey: storage\.listKeys\(\)\.keys\[0\]\.value\s*shareName: share\.name\s*accessMode: 'ReadWrite'\s*\}/,
    );
    expect(bicep).toContain("var keyStorageName = 'hochstapler-data'");
    // the account key is read exactly once, for this definition; never a workspace key, a SAS or an output
    expect(bicep.match(/listKeys\(/g)).toHaveLength(1);
    expect(bicep).not.toMatch(/sharedKey:|listAccountSas|listServiceSas/);
  });
  it("identity: the managed-identity definition hochstapler-data-mi (preview API), after the role exists", () => {
    const miStorage = resource("envStorageMi");
    expect(miStorage).toMatch(
      /^resource envStorageMi 'Microsoft\.App\/managedEnvironments\/storages@2026-03-02-preview' = if \(!useKey\) \{/,
    );
    expect(miStorage).toContain("name: miStorageName");
    expect(miStorage).toMatch(
      /azureFile: \{\s*accountName: storage\.name\s*identity: pullIdentity\.id\s*shareName: share\.name\s*accessMode: 'ReadWrite'\s*\}/,
    );
    expect(miStorage).toContain("dependsOn: [shareMountRole]");
    expect(miStorage).not.toContain("accountKey");
    expect(bicep).toContain("var miStorageName = 'hochstapler-data-mi'");
  });
  it("the app mounts the definition of the selected mode and waits for it", () => {
    expect(bicep).toContain("var envStorageName = useKey ? keyStorageName : miStorageName");
    const app = resource("app");
    expect(app).toContain("storageName: envStorageName");
    expect(app).toContain("dependsOn: [acrPull, leaseRole, envStorageKey, envStorageMi]");
  });
  it("keeps SMB OAuth on the account in both modes (needed to investigate the identity mount)", () => {
    expect(resource("storage")).toMatch(
      /azureFilesIdentityBasedAuthentication: \{\s*directoryServiceOptions: 'None'\s*smbOAuthSettings: \{ isSmbOAuthEnabled: true \}/,
    );
  });
  it("puts the app's user-assigned identity on the environment", () => {
    expect(resource("environment")).toMatch(
      /identity: \{\s*type: 'UserAssigned'\s*userAssignedIdentities: \{ '\$\{pullIdentity\.id\}': \{\} \}\s*\}/,
    );
  });
  it("grants Storage File Data SMB MI Admin to that identity at storage account scope", () => {
    expect(bicep).toContain("var smbMiAdminRoleId = 'a235d3ee-5935-4cfb-8cc5-a3303ad5995e'");
    const role = resource("shareMountRole");
    expect(role).toMatch(
      /^resource shareMountRole 'Microsoft\.Authorization\/roleAssignments@[^']+' = \{\s*scope: storage\s/,
    );
    expect(role).toContain("name: guid(storage.id, pullIdentity.id, smbMiAdminRoleId)");
    expect(role).toContain("principalId: pullIdentity.properties.principalId");
    expect(role).toContain("principalType: 'ServicePrincipal'");
    expect(role).toContain(
      "roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', smbMiAdminRoleId)",
    );
  });
  it("sends the environment logs to Log Analytics through diagnostic settings (console + system, never HTTP logs)", () => {
    expect(resource("environment")).toMatch(
      /appLogsConfiguration: \{\s*destination: 'azure-monitor'\s*\}/,
    );
    const diag = resource("envLogs");
    expect(diag).toMatch(
      /^resource envLogs 'Microsoft\.Insights\/diagnosticSettings@[^']+' = \{\s*scope: environment\s/,
    );
    expect(diag).toContain("workspaceId: logs.id");
    expect(diag).toContain("logAnalyticsDestinationType: 'Dedicated'");
    expect(diag).toContain("{ category: 'ContainerAppConsoleLogs', enabled: true }");
    expect(diag).toContain("{ category: 'ContainerAppSystemLogs', enabled: true }");
    // HTTP logs would carry client addresses and raw URLs (AGENTS.md telemetry rule)
    expect(diag).not.toMatch(/ContainerAppHTTPLogs|allLogs|categoryGroup/);
  });
});
