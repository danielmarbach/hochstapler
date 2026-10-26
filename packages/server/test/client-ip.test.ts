import { describe, expect, it } from "vitest";
import { clientIp, limitKey, loadTrustProxyHops } from "../src/client-ip.ts";

const req = (remote: string | undefined, xff?: string | string[]) => ({
  socket: { remoteAddress: remote },
  headers: xff === undefined ? {} : { "x-forwarded-for": xff },
});

describe("clientIp", () => {
  it("is the socket address by default and ignores x-forwarded-for", () => {
    expect(clientIp(req("10.0.0.7", "1.2.3.4"), 0)).toBe("10.0.0.7");
  });

  it("takes the entry the trusted proxy appended (n-th from the right), never the leftmost", () => {
    expect(clientIp(req("10.0.0.7", "9.9.9.9, 203.0.113.5"), 1)).toBe("203.0.113.5");
    expect(clientIp(req("10.0.0.7", "6.6.6.6, 203.0.113.5, 10.1.1.1"), 2)).toBe("203.0.113.5");
  });

  it("forged leftmost entries do not change the result", () => {
    const real = clientIp(req("10.0.0.7", "203.0.113.5"), 1);
    for (const forged of ["1.1.1.1", "2.2.2.2, 3.3.3.3", "::1", "evil"]) {
      expect(clientIp(req("10.0.0.7", `${forged}, 203.0.113.5`), 1)).toBe(real);
    }
  });

  it("joins repeated header lines and tolerates spaces", () => {
    expect(clientIp(req("10.0.0.7", ["1.1.1.1", " 203.0.113.5 "]), 1)).toBe("203.0.113.5");
  });

  it("falls back to the socket when the chain is shorter than trusted or the entry is junk", () => {
    expect(clientIp(req("10.0.0.7"), 1)).toBe("10.0.0.7");
    expect(clientIp(req("10.0.0.7", "203.0.113.5"), 2)).toBe("10.0.0.7");
    expect(clientIp(req("10.0.0.7", "1.1.1.1, not-an-ip"), 1)).toBe("10.0.0.7");
    expect(clientIp(req(undefined), 0)).toBe("unknown");
  });

  it("strips ports and brackets and normalises IPv6 case", () => {
    expect(clientIp(req("10.0.0.7", "203.0.113.5:49152"), 1)).toBe("203.0.113.5");
    expect(clientIp(req("10.0.0.7", "[2001:DB8::1]:443"), 1)).toBe("2001:db8::1");
    expect(clientIp(req("10.0.0.7", "2001:DB8::1"), 1)).toBe("2001:db8::1");
    expect(clientIp(req("::ffff:10.0.0.7"), 0)).toBe("10.0.0.7");
  });
});

describe("clientIp edge cases (proxy-addr)", () => {
  it("canonicalises IPv4-mapped IPv6 entries in the header", () => {
    expect(clientIp(req("10.0.0.7", "::FFFF:203.0.113.5"), 1)).toBe("203.0.113.5");
    expect(clientIp(req("10.0.0.7", "[::ffff:203.0.113.5]:443"), 1)).toBe("203.0.113.5");
  });

  it("walks IPv6 chains from the right and ignores empty entries", () => {
    expect(clientIp(req("10.0.0.7", "6.6.6.6,,2001:db8::5, 10.1.1.1"), 2)).toBe("2001:db8::5");
    expect(clientIp(req("10.0.0.7", ["6.6.6.6", "2001:db8::5", "10.1.1.1"]), 2)).toBe(
      "2001:db8::5",
    );
  });

  it("never returns the leftmost entry of a chain shorter than the trusted hops", () => {
    expect(clientIp(req("10.0.0.7", "6.6.6.6"), 3)).toBe("10.0.0.7");
    expect(clientIp(req("10.0.0.7", "6.6.6.6, 7.7.7.7"), 3)).toBe("10.0.0.7");
  });
});

describe("limitKey", () => {
  it("keeps IPv4 and collapses IPv6 to its /64 so a client cannot rotate through its own prefix", () => {
    expect(limitKey("203.0.113.5")).toBe("203.0.113.5");
    expect(limitKey("unknown")).toBe("unknown");
    expect(limitKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(limitKey("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(limitKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(limitKey("::1")).toBe("0:0:0:0::/64");
  });
});

describe("loadTrustProxyHops", () => {
  it("defaults to 0 and validates the env", () => {
    expect(loadTrustProxyHops({})).toBe(0);
    expect(loadTrustProxyHops({ TRUST_PROXY_HOPS: "1" })).toBe(1);
    expect(() => loadTrustProxyHops({ TRUST_PROXY_HOPS: "-1" })).toThrow();
    expect(() => loadTrustProxyHops({ TRUST_PROXY_HOPS: "one" })).toThrow();
    expect(() => loadTrustProxyHops({ TRUST_PROXY_HOPS: "1.5" })).toThrow();
  });
});
