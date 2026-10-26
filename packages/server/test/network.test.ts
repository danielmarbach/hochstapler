import { describe, expect, it } from "vitest";
import type { NetworkInterfaceInfo } from "node:os";
import { lanAddresses, startupUrls } from "../src/network.ts";

const iface = (address: string, family: "IPv4" | "IPv6", internal: boolean): NetworkInterfaceInfo =>
  ({
    address,
    family,
    internal,
    netmask: "",
    mac: "",
    cidr: null,
    ...(family === "IPv6" ? { scopeid: 0 } : {}),
  }) as NetworkInterfaceInfo;

describe("LAN addresses for playing in the local network", () => {
  const interfaces = {
    lo0: [iface("127.0.0.1", "IPv4", true), iface("::1", "IPv6", true)],
    en0: [iface("fe80::1", "IPv6", false), iface("192.168.1.24", "IPv4", false)],
    utun3: [iface("100.64.10.96", "IPv4", false)],
    utun4: undefined,
  };

  it("lists only external IPv4 addresses, home network (192.168.x) first", () => {
    const vpnListedFirst = { utun3: interfaces.utun3, en0: interfaces.en0, lo0: interfaces.lo0 };
    expect(lanAddresses(vpnListedFirst)).toEqual([
      { interfaceName: "en0", address: "192.168.1.24" },
      { interfaceName: "utun3", address: "100.64.10.96" },
    ]);
  });

  it("prints localhost first, then LAN URLs with interface names", () => {
    expect(startupUrls(8787, interfaces)).toEqual([
      "http://localhost:8787",
      "http://192.168.1.24:8787 (en0)",
      "http://100.64.10.96:8787 (utun3)",
    ]);
  });
});
