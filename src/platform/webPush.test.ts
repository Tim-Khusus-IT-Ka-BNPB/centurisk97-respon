import { describe, expect, test } from "vitest";
import { phone, vapidKeys } from "../testing/push";
import { encryptPush, fromBase64Url, pushRequest, toBase64Url, vapidToken } from "./webPush";

const utf8 = (text: string) => new TextEncoder().encode(text);

const hkdf = async (salt: Uint8Array<ArrayBuffer>, secret: ArrayBuffer, info: Uint8Array<ArrayBuffer>, bytes: number) =>
  crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]),
    bytes * 8,
  );

// What the phone does with the message: RFC 8291 read backwards.
async function decrypt(body: Uint8Array<ArrayBuffer>, own: Awaited<ReturnType<typeof phone>>) {
  const salt = body.slice(0, 16);
  const recordSize = new DataView(body.buffer).getUint32(16);
  const idLength = body[20] as number;
  const sender = body.slice(21, 21 + idLength);
  const sealed = body.slice(21 + idLength);
  const senderKey = await crypto.subtle.importKey("raw", sender, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: senderKey }, own.pair.privateKey, 256);
  const info = new Uint8Array([...utf8("WebPush: info\0"), ...own.raw, ...sender]);
  const ikm = await hkdf(own.auth, shared, info, 32);
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(nonce) }, key, sealed),
  );
  return { recordSize, idLength, delimiter: plain.at(-1), text: new TextDecoder().decode(plain.slice(0, -1)) };
}

describe("web push", () => {
  test("only the phone it is for can read the message", async () => {
    const own = await phone();
    const body = await encryptPush(own.target, '{"title":"Siaga banjir"}');
    expect(await decrypt(body, own)).toEqual({
      recordSize: 4096,
      idLength: 65,
      delimiter: 2,
      text: '{"title":"Siaga banjir"}',
    });
    const other = await phone();
    await expect(decrypt(body, other)).rejects.toThrow();
  });

  test("each message has its own salt and key", async () => {
    const own = await phone();
    const [a, b] = [await encryptPush(own.target, "x"), await encryptPush(own.target, "x")];
    expect(toBase64Url(a.slice(0, 16))).not.toBe(toBase64Url(b.slice(0, 16)));
    expect(toBase64Url(a.slice(21, 86))).not.toBe(toBase64Url(b.slice(21, 86)));
  });

  test("the token is signed by the server's key, for the push service, for 12 hours", async () => {
    const keys = await vapidKeys();
    const nowMs = Date.UTC(2026, 10, 26, 3);
    const token = await vapidToken(keys, "https://fcm.googleapis.com/fcm/send/uji", nowMs);
    const [header, claims, signature] = token.split(".") as [string, string, string];
    const read = (part: string) => JSON.parse(new TextDecoder().decode(fromBase64Url(part)));
    expect(read(header)).toEqual({ typ: "JWT", alg: "ES256" });
    expect(read(claims)).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: nowMs / 1000 + 43_200,
      sub: "mailto:peringatan@example.test",
    });
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keys.verify,
      fromBase64Url(signature),
      utf8(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
  });

  test("the request carries the token, the key and the sealed body", async () => {
    const keys = await vapidKeys();
    const own = await phone();
    const request = await pushRequest(keys, own.target, "hi", Date.now());
    expect(request.method).toBe("POST");
    expect(request.url).toBe(own.target.endpoint);
    expect(request.headers.get("authorization")).toMatch(
      new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${keys.publicKey}$`),
    );
    expect(Object.fromEntries([...request.headers].filter(([name]) => name !== "authorization"))).toEqual({
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "86400",
      urgency: "high",
    });
    expect((await decrypt(new Uint8Array(await request.arrayBuffer()), own)).text).toBe("hi");
  });

  test("base64url both ways, with no padding", () => {
    const bytes = new Uint8Array([251, 255, 0, 1]);
    expect(toBase64Url(bytes)).toBe("-_8AAQ");
    expect([...fromBase64Url("-_8AAQ")]).toEqual([...bytes]);
  });
});
