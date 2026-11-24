import { hitCounter } from "../adapters/d1/limits";
import { isOverLimit, LIMITS, type LimitId, retryAt, windowStart } from "../domain/limits";
import { hmacKey } from "../platform/keys";
import type { ServiceBindings } from "./bindings";

type FixedLimitId = {
  [Id in LimitId]: (typeof LIMITS)[Id]["window"] extends "minute" | "clockHour" | "wibDay" ? Id : never;
}[LimitId];

export type LimitSubject =
  | { readonly kind: "numberSlot"; readonly numberKey: string; readonly ownerSlot: string }
  | { readonly kind: "device"; readonly deviceId: string }
  | { readonly kind: "address"; readonly bucket: string }
  | { readonly kind: "staff"; readonly staffId: string };

export type LimitRefusal = { readonly limitId: LimitId; readonly retryAtMs: number | null };

// Subject keys are HMACs, so a counter row never holds a number, a device id or an address.
async function subjectKey(secret: string, subject: LimitSubject): Promise<string> {
  if (subject.kind === "address") return hmacKey(secret, "address", subject.bucket);
  if (subject.kind === "device") return hmacKey(secret, "subject", `device:${subject.deviceId}`);
  if (subject.kind === "staff") return hmacKey(secret, "subject", `staff:${subject.staffId}`);
  return hmacKey(secret, "subject", `${subject.numberKey}:${subject.ownerSlot}`);
}

// Counts this request against each limit in turn and stops at the first one it is over.
export async function checkLimits(
  bindings: ServiceBindings,
  checks: readonly (readonly [FixedLimitId, LimitSubject])[],
): Promise<LimitRefusal | null> {
  const nowMs = bindings.clock.now();
  for (const [limitId, subject] of checks) {
    const window = LIMITS[limitId].window as "minute" | "clockHour" | "wibDay";
    const key = await subjectKey(bindings.settings.keyHmacSecret, subject);
    const count = await hitCounter(bindings.db, limitId, key, new Date(windowStart(window, nowMs)));
    if (isOverLimit(limitId, count)) return { limitId, retryAtMs: retryAt(window, nowMs) };
  }
  return null;
}
