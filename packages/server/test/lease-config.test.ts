// WRITER_LEASE selects the provider (default: file next to the database). Invalid settings abort the start.
import { describe, expect, it } from "vitest";
import { loadHandoverMode, loadWriterLease } from "../src/lease/config.ts";

const azure = {
  WRITER_LEASE: "azure-blob",
  WRITER_LEASE_ACCOUNT_URL: "https://stexample.blob.core.windows.net/",
  WRITER_LEASE_CONTAINER: "leases",
  IDENTITY_ENDPOINT: "http://localhost:42356/msi/token",
  IDENTITY_HEADER: "hdr",
  AZURE_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
};

describe("loadWriterLease", () => {
  it("defaults to the file lease in the data directory", () => {
    expect(loadWriterLease({}, "/tmp/x").kind).toBe("file");
    expect(loadWriterLease({ WRITER_LEASE: "file" }, "/tmp/x").kind).toBe("file");
  });
  it("an in-memory database has nothing to share: single instance", () => {
    expect(loadWriterLease({}, ":memory:").kind).toBe("single");
  });
  it("selects the Azure Blob lease with account URL, container and the managed identity endpoint", () => {
    const l = loadWriterLease(azure, "/data");
    expect(l.kind).toBe("azure-blob");
    expect(l.timing.durationMs).toBe(15_000);
  });
  it.each([
    ["WRITER_LEASE_ACCOUNT_URL", "http://stexample.blob.core.windows.net"],
    ["WRITER_LEASE_ACCOUNT_URL", "https://stexample.blob.core.windows.net/?sv=2020&sig=abc"],
    ["WRITER_LEASE_ACCOUNT_URL", undefined],
    ["WRITER_LEASE_CONTAINER", "Bad_Name"],
    ["IDENTITY_ENDPOINT", undefined],
    ["IDENTITY_HEADER", undefined],
  ])("refuses azure-blob with %s=%s", (key, value) => {
    const env: Record<string, string | undefined> = { ...azure, [key]: value };
    expect(() => loadWriterLease(env, "/data")).toThrow(/WRITER_LEASE|IDENTITY/);
  });
  it("refuses unknown providers", () => {
    expect(() => loadWriterLease({ WRITER_LEASE: "redis" }, "/data")).toThrow(/WRITER_LEASE/);
  });
  it("'none' (one in-process instance, tests) is refused in production", () => {
    expect(loadWriterLease({ WRITER_LEASE: "none" }, "/data").kind).toBe("single");
    expect(() =>
      loadWriterLease({ WRITER_LEASE: "none", NODE_ENV: "production" }, "/data"),
    ).toThrow(/production/);
  });
});

describe("loadHandoverMode (WRITER_LEASE_HANDOVER, DESIGN #91)", () => {
  it("defaults to immediate (local, LAN, compose)", () => {
    expect(loadHandoverMode({})).toBe("immediate");
    expect(loadHandoverMode({ WRITER_LEASE_HANDOVER: "" })).toBe("immediate");
    expect(loadHandoverMode({ WRITER_LEASE_HANDOVER: "immediate" })).toBe("immediate");
  });
  it("accepts on-traffic (Azure: the deploy script shifts the traffic first)", () => {
    expect(loadHandoverMode({ WRITER_LEASE_HANDOVER: "on-traffic" })).toBe("on-traffic");
  });
  it("refuses anything else", () => {
    expect(() => loadHandoverMode({ WRITER_LEASE_HANDOVER: "later" })).toThrow(
      /WRITER_LEASE_HANDOVER/,
    );
  });
});
