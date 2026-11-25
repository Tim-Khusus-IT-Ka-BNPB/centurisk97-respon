import { describe, expect, test } from "vitest";
import { hmacKey, isSignatureOf, sha256Hex, signText } from "./keys";

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

  test("a signature holds for its own secret and text alone", async () => {
    const signature = await signText(SECRET, "pesan");
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(await isSignatureOf(SECRET, "pesan", signature)).toBe(true);
    expect(await isSignatureOf(SECRET, "pesan ", signature)).toBe(false);
    expect(await isSignatureOf(`${SECRET}!`, "pesan", signature)).toBe(false);
    expect(
      await isSignatureOf(
        SECRET,
        "pesan",
        signature.replace(/^./, (one) => (one === "0" ? "1" : "0")),
      ),
    ).toBe(false);
    expect(await isSignatureOf(SECRET, "pesan", "")).toBe(false);
  });

  test("bytes have the fingerprint of the text they spell", async () => {
    expect(await sha256Hex(new TextEncoder().encode("seeded-token"))).toBe(await sha256Hex("seeded-token"));
  });

  test("a fingerprint is plain SHA-256", async () => {
    expect(await sha256Hex("seeded-token")).toBe("cc6b7985a1b665a57c305777f30d44c4f6d78fc022d92f5873afcd918670a530");
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
