import type { DraftBody } from "../../src/contract/draft";
import type { ErrorEnvelope } from "../../src/contract/errors";
import type { Text } from "../../src/copy/text";
import { retryText } from "../../src/copy/time";
import { isLimit } from "./envelope";
import { searchStatus } from "./place";

// A limit's words with its retry time filled in.
export function limitText(t: Text, envelope: ErrorEnvelope, nowMs: number): string {
  const retry = envelope.retryAt ? retryText(envelope.retryAt, nowMs) : null;
  const retryTime = retry ? t(retry.key, retry.params) : "";
  return t(envelope.error.copyKey, { ...envelope.error.params, retryTime });
}

// The refusal answering a typed message: the assistant line just before the new question.
function refusalOf(draft: DraftBody): string | null {
  const before = draft.transcript.at(-2);
  return before?.speaker === "assistant" && before.copyKey.startsWith("refusal.") ? before.copyKey : null;
}

// What the one polite status says: search counts, a refusal, or a limit. Nothing else is announced.
export function statusText(t: Text, draft: DraftBody, envelope: ErrorEnvelope | null, nowMs: number): string {
  if (envelope !== null && isLimit(envelope)) return limitText(t, envelope, nowMs);
  const refusal = refusalOf(draft);
  if (refusal !== null) return t(refusal);
  return searchStatus(draft.card, t);
}
