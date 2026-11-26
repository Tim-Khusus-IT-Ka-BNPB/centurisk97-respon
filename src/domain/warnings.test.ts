import { describe, expect, test } from "vitest";
import { ALL_HAZARDS, pushEndpointOk, pushKeysOk, WARNING_HAZARDS } from "./warnings";

describe("a phone's push", () => {
  test.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://android.googleapis.com/gcm/send/abc",
    "https://web.push.apple.com/QGx",
    "https://api.push.apple.com/x",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
    "https://updates.push.services.mozilla.com/wpush/v2/x",
  ])("%s is a push service", (endpoint) => {
    expect(pushEndpointOk(endpoint)).toBe(true);
  });

  test.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com.example.test/x",
    "https://evilpush.apple.com.example.test/x",
    "https://notpush.apple.comx/x",
    "https://example.test/fcm.googleapis.com",
    "not an address",
    `https://fcm.googleapis.com/${"a".repeat(1000)}`,
  ])("%s is not", (endpoint) => {
    expect(pushEndpointOk(endpoint)).toBe(false);
  });

  test("the phone's keys are base64url of the browser's lengths", () => {
    const p256dh = "B".repeat(87);
    expect(pushKeysOk(p256dh, "a".repeat(22))).toBe(true);
    expect(pushKeysOk("B".repeat(80), "a".repeat(20))).toBe(true);
    expect(pushKeysOk("B".repeat(100), "a".repeat(30))).toBe(true);
    expect(pushKeysOk("B".repeat(79), "a".repeat(22))).toBe(false);
    expect(pushKeysOk("B".repeat(101), "a".repeat(22))).toBe(false);
    expect(pushKeysOk(p256dh, "a".repeat(19))).toBe(false);
    expect(pushKeysOk(p256dh, "a".repeat(31))).toBe(false);
    expect(pushKeysOk(`${"B".repeat(86)}=`, "a".repeat(22))).toBe(false);
    expect(pushKeysOk(p256dh, `${"a".repeat(21)}+`)).toBe(false);
  });

  test("every hazard is one bit, and all of them make the whole choice", () => {
    expect(WARNING_HAZARDS.reduce((sum, [, bit]) => sum | bit, 0)).toBe(ALL_HAZARDS);
  });
});
