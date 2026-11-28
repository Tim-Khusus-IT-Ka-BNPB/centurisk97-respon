import { describe, expect, test } from "vitest";
import { addressBucket, clientAddress } from "./address";

const headers = (entries: Record<string, string>) => new Headers(entries);

describe("client address", () => {
  test("IPv4 is kept whole", () => {
    expect(addressBucket("203.0.113.7")).toBe("203.0.113.7");
    expect(addressBucket("203.0.113.256")).toBeNull();
    expect(addressBucket("203.0.113")).toBeNull();
  });

  test("IPv6 is bucketed by its /64 prefix", () => {
    expect(addressBucket("2001:DB8:0:1:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:0:1::/64");
    expect(addressBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(addressBucket("::1")).toBe("0:0:0:0::/64");
    expect(addressBucket("2001:db8:0:1::")).toBe("2001:db8:0:1::/64");
    expect(addressBucket("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  test("malformed IPv6 is refused", () => {
    expect(addressBucket("2001::db8::1")).toBeNull();
    expect(addressBucket("2001:db8:0:1:2:3:4")).toBeNull();
    expect(addressBucket("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(addressBucket("1:2:3:4::5:6:7:8")).toBeNull();
    expect(addressBucket("2001:db8::zzzz")).toBeNull();
    expect(addressBucket("::ffff:999.0.0.1")).toBeNull();
  });

  test("only x-client-address is read; x-forwarded-for is ignored", () => {
    expect(clientAddress(headers({ "x-client-address": " 198.51.100.2 ", "x-forwarded-for": "10.0.0.1" }), null)).toBe(
      "198.51.100.2",
    );
    expect(clientAddress(headers({ "x-forwarded-for": "10.0.0.1" }), null)).toBeNull();
  });

  test("with no address header only the test fallback answers", () => {
    expect(clientAddress(headers({}), null)).toBeNull();
    expect(clientAddress(headers({ "x-client-address": "  " }), null)).toBeNull();
    expect(clientAddress(headers({}), "loopback")).toBe("loopback");
    expect(clientAddress(headers({ "x-client-address": "bad" }), "loopback")).toBeNull();
  });
});
