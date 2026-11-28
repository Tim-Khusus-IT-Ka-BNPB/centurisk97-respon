import { claimMessage, releaseMessage } from "../adapters/postgres/gateway";
import { isFresh, readGatewayHeaders, signedText } from "../domain/gateway";
import { isSignatureOf, sha256Hex } from "../platform/keys";
import type { ServiceBindings } from "./bindings";

type Call = {
  readonly method: string;
  readonly path: string;
  readonly header: (name: string) => string | undefined;
  readonly body: Uint8Array<ArrayBuffer>;
  // A write uses its message id up.
  readonly once: boolean;
};

export type Admitted =
  | { readonly kind: "ok"; readonly gatewayId: string; readonly giveBack: () => Promise<void> }
  | { readonly kind: "refused" }
  | { readonly kind: "replayed" };

// Every refusal before the message id is the same, so a caller learns nothing of which part was wrong.
export async function admitCall(bindings: ServiceBindings, call: Call): Promise<Admitted> {
  const claimed = readGatewayHeaders(call.header);
  if (claimed === null) return { kind: "refused" };
  const { gatewayId, messageId, timeMs, signature } = claimed;
  const secret = bindings.settings.gatewaySecrets.get(gatewayId);
  const now = bindings.clock.now();
  if (secret === undefined || !isFresh(timeMs, now)) return { kind: "refused" };
  const bodyHash = await sha256Hex(call.body);
  const text = signedText({ method: call.method, path: call.path, timeMs, messageId, bodyHash });
  if (!(await isSignatureOf(secret, text, signature))) return { kind: "refused" };
  if (call.once && !(await claimMessage(bindings.db, gatewayId, messageId, new Date(now)))) return { kind: "replayed" };
  return { kind: "ok", gatewayId, giveBack: () => releaseMessage(bindings.db, gatewayId, messageId) };
}
