// Provider selection (docs/DESIGN.md #89):
//   WRITER_LEASE=file        (default) lock file next to the database; LOCAL disks only (dev, LAN compose, e2e)
//   WRITER_LEASE=azure-blob  Azure Blob lease: WRITER_LEASE_ACCOUNT_URL (https, no query), WRITER_LEASE_CONTAINER,
//                            IDENTITY_ENDPOINT + IDENTITY_HEADER (set by Container Apps), optional AZURE_CLIENT_ID
//   WRITER_LEASE=none        one in-process instance (tests); refused with NODE_ENV=production
// Invalid settings abort the start before the database is opened. A new backend (k8s Lease, Postgres advisory lock,
// etcd) is one more WriterLease implementation plus a branch here.
import { z } from "zod";
import { AzureBlobLease, ManagedIdentityToken } from "./azure-blob.ts";
import type { LeaseIssue, LeaseOp } from "./azure-blob.ts";
import { FileLease } from "./file.ts";
import { SingleInstanceLease } from "./single.ts";
import type { LeaseTiming, WriterLease } from "./types.ts";

/** Same timing as Azure: the state machine behaves the same locally. */
export const FILE_LEASE_TIMING: LeaseTiming = {
  durationMs: 15_000,
  renewIntervalMs: 3000,
  safetyMarginMs: 5000,
};

const KindSchema = z.enum(["file", "azure-blob", "none"]).default("file");
const AzureSchema = z.object({
  WRITER_LEASE_ACCOUNT_URL: z.string().refine((s) => {
    const u = URL.canParse(s) ? new URL(s) : null;
    return u !== null && u.protocol === "https:" && u.search === "" && u.hash === "" && !u.username;
  }, "WRITER_LEASE_ACCOUNT_URL must be https://<account>.blob.<suffix> without query (no SAS)"),
  WRITER_LEASE_CONTAINER: z
    .string()
    .regex(
      /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,62}$/,
      "WRITER_LEASE_CONTAINER: Azure container name",
    ),
  IDENTITY_ENDPOINT: z
    .string()
    .url("IDENTITY_ENDPOINT (Container Apps managed identity) is missing"),
  IDENTITY_HEADER: z
    .string()
    .min(1, "IDENTITY_HEADER (Container Apps managed identity) is missing"),
  AZURE_CLIENT_ID: z.string().min(1).optional(),
});

/**
 * WRITER_LEASE_HANDOVER (DESIGN #91): when a fresh process asks the running holder to hand over.
 *   immediate  (default) at once on start: local, LAN, compose (no traffic switch in front of the instances)
 *   on-traffic on its first real request: Azure, where the deploy script shifts the traffic to the new revision first
 */
export type HandoverMode = "immediate" | "on-traffic";
const HandoverSchema = z.enum(["immediate", "on-traffic"]).default("immediate");

export function loadHandoverMode(env: NodeJS.ProcessEnv): HandoverMode {
  const parsed = HandoverSchema.safeParse(env["WRITER_LEASE_HANDOVER"] || undefined);
  if (!parsed.success)
    throw new Error("WRITER_LEASE_HANDOVER must be one of: immediate, on-traffic");
  return parsed.data;
}

export interface LeaseConfigOptions {
  onIssue?: (op: LeaseOp, issue: LeaseIssue) => void;
}

export function loadWriterLease(
  env: NodeJS.ProcessEnv,
  dataDir: string,
  opts: LeaseConfigOptions = {},
): WriterLease {
  const kind = KindSchema.safeParse(env["WRITER_LEASE"] || undefined);
  if (!kind.success) throw new Error("WRITER_LEASE must be one of: file, azure-blob, none");
  switch (kind.data) {
    case "none":
      if (env["NODE_ENV"] === "production")
        throw new Error("WRITER_LEASE=none is not allowed in production (use file or azure-blob)");
      return new SingleInstanceLease();
    case "file":
      return dataDir === ":memory:"
        ? new SingleInstanceLease()
        : new FileLease(dataDir, { timing: FILE_LEASE_TIMING });
    case "azure-blob": {
      const parsed = AzureSchema.safeParse(env);
      if (!parsed.success)
        throw new Error(
          `WRITER_LEASE=azure-blob: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        );
      const c = parsed.data;
      const identity: { endpoint: string; header: string; clientId?: string } = {
        endpoint: c.IDENTITY_ENDPOINT,
        header: c.IDENTITY_HEADER,
      };
      if (c.AZURE_CLIENT_ID) identity.clientId = c.AZURE_CLIENT_ID;
      return new AzureBlobLease({
        accountUrl: c.WRITER_LEASE_ACCOUNT_URL,
        container: c.WRITER_LEASE_CONTAINER,
        token: new ManagedIdentityToken(identity),
        ...(opts.onIssue ? { onIssue: opts.onIssue } : {}),
      });
    }
  }
}
