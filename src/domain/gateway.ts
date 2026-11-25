// A gateway's call is signed with that gateway's own secret over all it says, and each write names a
// message id that is used once. A key shared by all could be replayed, and not taken back from one.
// No imports: the test gateway signs with this same file.

export const GATEWAY = {
  // A call older or newer than this is refused.
  clockSkewMs: 5 * 60_000,
} as const;

export type GatewayCall = {
  readonly method: string;
  // With its query, as it was asked for.
  readonly path: string;
  readonly timeMs: number;
  readonly messageId: string;
  // SHA-256 of the body, in hex.
  readonly bodyHash: string;
};

export const signedText = (call: GatewayCall): string =>
  [call.method, call.path, call.timeMs, call.messageId, call.bodyHash].join("\n");

export type GatewayHeaders = {
  readonly gatewayId: string;
  readonly timeMs: number;
  readonly messageId: string;
  readonly signature: string;
};

const TIME = /^\d{13}$/;
const MESSAGE_ID = /^[\w.:=+/-]{6,128}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;

// What the call claims of itself, or null when a part is missing or misshapen.
export function readGatewayHeaders(header: (name: string) => string | undefined): GatewayHeaders | null {
  const [gatewayId, time, messageId, signature] = ["id", "time", "message", "signature"].map(
    (name) => header(`x-gateway-${name}`) ?? "",
  ) as [string, string, string, string];
  if (!TIME.test(time) || !MESSAGE_ID.test(messageId) || !SIGNATURE.test(signature)) return null;
  return { gatewayId, timeMs: Number(time), messageId, signature };
}

export const isFresh = (timeMs: number, nowMs: number): boolean => Math.abs(nowMs - timeMs) <= GATEWAY.clockSkewMs;
