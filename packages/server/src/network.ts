import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

export interface LanAddress {
  interfaceName: string;
  address: string;
}

/** Typical home-router range first (192.168.x), then other private ranges, VPN/CGNAT (100.64/10) last. */
function homeNetworkRank(address: string): number {
  if (address.startsWith("192.168.")) {
    return 0;
  }
  if (address.startsWith("10.") || /^172\.(1[6-9]|2\d|3[01])\./.test(address)) {
    return 1;
  }
  return 2;
}

/** IPv4 addresses other devices in the local network can use to reach this machine. */
export function lanAddresses(interfaces: Interfaces = networkInterfaces()): LanAddress[] {
  return Object.entries(interfaces)
    .flatMap(([interfaceName, infos]) => (infos ?? []).map((info) => ({ interfaceName, info })))
    .filter(({ info }) => info.family === "IPv4" && !info.internal)
    .map(({ interfaceName, info }) => ({ interfaceName, address: info.address }))
    .sort((a, b) => homeNetworkRank(a.address) - homeNetworkRank(b.address));
}

/** Startup lines: localhost first, then one per LAN address (with interface name, home network first). */
export function startupUrls(port: number, interfaces?: Interfaces): string[] {
  return [
    `http://localhost:${port}`,
    ...lanAddresses(interfaces).map(
      ({ interfaceName, address }) => `http://${address}:${port} (${interfaceName})`,
    ),
  ];
}
