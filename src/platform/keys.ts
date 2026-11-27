// Keys of people and addresses: HMAC-SHA-256 under the server secret, so a stored key cannot be
// reversed by trying numbers. Each kind has its own label so a number never collides with an address.
// "feed" stands for a public feed entry without naming its report.
export type KeyKind = "number" | "address" | "subject" | "tracking" | "feed" | "today" | "case";

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const hmac = (secret: string, use: "sign" | "verify") =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [use]);

// A text signed with a secret, in hex.
export async function signText(secret: string, text: string): Promise<string> {
  return hex(await crypto.subtle.sign("HMAC", await hmac(secret, "sign"), encoder.encode(text)));
}

// Whether a signature in hex is this text's, compared in constant time.
export async function isSignatureOf(secret: string, text: string, signature: string): Promise<boolean> {
  const bytes = Uint8Array.from(signature.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
  return crypto.subtle.verify("HMAC", await hmac(secret, "verify"), bytes, encoder.encode(text));
}

export const hmacKey = (secret: string, kind: KeyKind, value: string): Promise<string> =>
  signText(secret, `${kind}:${value}`);

// Fingerprints of random secrets (the device key, a session token): plain SHA-256 is enough.
export async function sha256Hex(value: string | Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value));
}
