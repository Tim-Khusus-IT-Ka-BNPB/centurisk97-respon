import { describe, expect, test } from "vitest";
import { GATEWAY, isFresh, readGatewayHeaders, signedText } from "./gateway";

const SIGNATURE = "0123456789abcdef".repeat(4);
const HEADERS: Readonly<Record<string, string>> = {
  "x-gateway-id": "uji-1",
  "x-gateway-time": "1764046800000",
  "x-gateway-message": "3EB0.C7:67=D2/6-A+_1",
  "x-gateway-signature": SIGNATURE,
};
const read = (changes: Readonly<Record<string, string | undefined>> = {}) => {
  const all = { ...HEADERS, ...changes };
  return readGatewayHeaders((name) => all[name]);
};

describe("a gateway's call", () => {
  test("what is signed holds every part, in order", () => {
    expect(
      signedText({
        method: "POST",
        path: "/api/gateway/messages?x=1",
        timeMs: 1764046800000,
        messageId: "m-1",
        bodyHash: "ab",
      }),
    ).toBe("POST\n/api/gateway/messages?x=1\n1764046800000\nm-1\nab");
  });

  test("its headers read", () => {
    expect(read()).toEqual({
      gatewayId: "uji-1",
      timeMs: 1764046800000,
      messageId: "3EB0.C7:67=D2/6-A+_1",
      signature: SIGNATURE,
    });
  });

  test("a missing or misshapen part is no call, and an unknown gateway is the caller's to refuse", () => {
    for (const name of ["time", "message", "signature"]) expect(read({ [`x-gateway-${name}`]: undefined })).toBeNull();
    for (const time of ["176404680000", "17640468000000", "a1764046800000", "1764046800000 "])
      expect(read({ "x-gateway-time": time }), time).toBeNull();
    for (const id of ["abcde", "a".repeat(129), "abc def", "abcdef!", "!abcdef"])
      expect(read({ "x-gateway-message": id }), id).toBeNull();
    expect(read({ "x-gateway-message": "a".repeat(128) })?.messageId).toHaveLength(128);
    expect(read({ "x-gateway-message": "abcdef" })?.messageId).toBe("abcdef");
    for (const signature of [SIGNATURE.slice(1), `${SIGNATURE}0`, SIGNATURE.toUpperCase(), `g${SIGNATURE.slice(1)}`])
      expect(read({ "x-gateway-signature": signature }), signature).toBeNull();
    expect(read({ "x-gateway-id": undefined })?.gatewayId).toBe("");
  });

  test("it is good for 5 minutes either way, both inclusive", () => {
    const now = 1764046800000;
    expect(GATEWAY.clockSkewMs).toBe(300_000);
    expect(isFresh(now, now)).toBe(true);
    expect(isFresh(now - 300_000, now)).toBe(true);
    expect(isFresh(now + 300_000, now)).toBe(true);
    expect(isFresh(now - 300_001, now)).toBe(false);
    expect(isFresh(now + 300_001, now)).toBe(false);
  });
});
