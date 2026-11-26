// Web Push on WebCrypto alone: the message encrypted for one phone (RFC 8291, aes128gcm) and
// signed for its push service (RFC 8292, VAPID). No library, so the Worker carries no Node code.

export type PushKeys = { readonly publicKey: string; readonly privateKey: string; readonly subject: string };
export type PushTarget = { readonly endpoint: string; readonly p256dh: string; readonly auth: string };

const RECORD_SIZE = 4096;
// How long a push service may hold a message for a phone that is off: a day.
const TTL_SECONDS = 86_400;

export const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));

export const toBase64Url = (bytes: Uint8Array | ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const joined = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const all = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
};

const utf8 = (text: string) => new TextEncoder().encode(text);

async function hkdf(salt: Uint8Array<ArrayBuffer>, secret: ArrayBuffer, info: Uint8Array<ArrayBuffer>, bytes: number) {
  const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8);
}

// One record, as RFC 8291 section 4: salt, record size, the sender's key, then the sealed text.
export async function encryptPush(target: PushTarget, plaintext: string): Promise<Uint8Array<ArrayBuffer>> {
  const phoneKey = fromBase64Url(target.p256dh);
  const own = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const ownPublic = new Uint8Array(await crypto.subtle.exportKey("raw", own.publicKey));
  const phone = await crypto.subtle.importKey("raw", phoneKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: phone }, own.privateKey, 256);
  const keyInfo = joined(utf8("WebPush: info\0"), phoneKey, ownPublic);
  const ikm = await hkdf(fromBase64Url(target.auth), shared, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // The last record ends with 2 and no padding.
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(nonce) },
    key,
    joined(utf8(plaintext), new Uint8Array([2])),
  );
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = ownPublic.length;
  return joined(header, ownPublic, new Uint8Array(sealed));
}

// A JWT the push service checks against the public key the phone subscribed with.
export async function vapidToken(keys: PushKeys, endpoint: string, nowMs: number): Promise<string> {
  const point = fromBase64Url(keys.publicKey);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: keys.privateKey,
    x: toBase64Url(point.slice(1, 33)),
    y: toBase64Url(point.slice(33, 65)),
  };
  const signer = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const part = (value: object) => toBase64Url(utf8(JSON.stringify(value)));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: keys.subject };
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part(claims)}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer, utf8(unsigned));
  return `${unsigned}.${toBase64Url(signature)}`;
}

// The request that hands one message to one phone's push service.
export async function pushRequest(keys: PushKeys, target: PushTarget, payload: string, nowMs: number) {
  return new Request(target.endpoint, {
    method: "POST",
    headers: {
      authorization: `vapid t=${await vapidToken(keys, target.endpoint, nowMs)}, k=${keys.publicKey}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(TTL_SECONDS),
      urgency: "high",
    },
    body: await encryptPush(target, payload),
  });
}
