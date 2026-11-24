// Keys of people and addresses: HMAC-SHA-256 under the server secret, so a stored key cannot be
// reversed by trying numbers. Each kind has its own label so a number never collides with an address.
export type KeyKind = "number" | "address" | "subject" | "tracking";

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export async function hmacKey(secret: string, kind: KeyKind, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${kind}:${value}`)));
}

// Fingerprints of random secrets (the device key, a session token): plain SHA-256 is enough.
export async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
