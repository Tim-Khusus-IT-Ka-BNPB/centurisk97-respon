// pnpm push:keys: a new VAPID pair for the warnings (M07), printed once for the Worker's secrets.
// Set all three per environment, never in a file:
//   npx wrangler secret put PUSH_PRIVATE_KEY --name <worker>
// A new pair stops every phone subscribed with the old one, so keep the pair for good.
import { toBase64Url } from "../../src/platform/webPush.ts";

const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
])) as CryptoKeyPair;
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
process.stdout.write(
  `PUSH_PUBLIC_KEY=${toBase64Url(await crypto.subtle.exportKey("raw", pair.publicKey))}\nPUSH_PRIVATE_KEY=${jwk.d}\nPUSH_SUBJECT=mailto:<an address BNPB reads>\n`,
);
