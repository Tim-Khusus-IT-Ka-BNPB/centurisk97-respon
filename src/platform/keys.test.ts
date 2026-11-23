import { describe, expect, test } from "vitest";
import { hmacKey, sha256Hex } from "./keys";

const SECRET = "test-sample-hmac-key-at-least-32-bytes";

describe("keys", () => {
  test("a number key is the HMAC of its label and value", async () => {
    expect(await hmacKey(SECRET, "number", "+6280000000001")).toBe(
      "26f51a643485c36ad469136329c2693f3e1fd1847f44a551437359af7259add6",
    );
  });

  test("labels keep kinds apart and the secret changes every key", async () => {
    const number = await hmacKey(SECRET, "number", "x");
    expect(await hmacKey(SECRET, "address", "x")).not.toBe(number);
    expect(await hmacKey(`${SECRET}!`, "number", "x")).not.toBe(number);
    expect(number).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a fingerprint is plain SHA-256", async () => {
    expect(await sha256Hex("seeded-token")).toBe("cc6b7985a1b665a57c305777f30d44c4f6d78fc022d92f5873afcd918670a530");
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
