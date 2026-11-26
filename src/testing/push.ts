import { type PushKeys, toBase64Url } from "../platform/webPush";

// A phone's own pair, as a browser makes it when it subscribes.
export async function phone() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    pair,
    raw,
    auth,
    target: { endpoint: "https://fcm.googleapis.com/fcm/send/uji", p256dh: toBase64Url(raw), auth: toBase64Url(auth) },
  };
}

// The server's VAPID pair, as the key tool makes it.
export async function vapidKeys(): Promise<PushKeys & { verify: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return {
    publicKey: toBase64Url(await crypto.subtle.exportKey("raw", pair.publicKey)),
    privateKey: jwk.d as string,
    subject: "mailto:peringatan@example.test",
    verify: pair.publicKey,
  };
}
