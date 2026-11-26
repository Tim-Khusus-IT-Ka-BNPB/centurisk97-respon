import { sameEventHours } from "./clusters";
import type { EventTimeValue } from "./fieldState";
import type { HazardTypeId } from "./hazards";
import type { TicketStatus } from "./stages";
import { HOUR_MS } from "./time";
import type { SameEventOffer } from "./turn/content";

// Reports a reporter may be telling of too (K66, D103): sent in the same district, still open, and
// recent for their hazard. At most three, one per hazard, the newest first.
const MAX_OFFERS = 3;

export type SameEventCandidate = {
  readonly ticketNumber: string;
  readonly hazardType: HazardTypeId;
  readonly hazardSubtype: string | null;
  readonly eventTime: EventTimeValue | null;
  readonly eventMs: number | null;
  readonly sentMs: number;
  readonly status: TicketStatus;
  readonly reporters: number;
};

const OVER: readonly TicketStatus[] = ["closed", "invalid"];

export function pickOffers(candidates: readonly SameEventCandidate[], nowMs: number): readonly SameEventOffer[] {
  const newest = new Map<HazardTypeId, SameEventCandidate & { readonly refMs: number }>();
  for (const candidate of candidates) {
    const refMs = Math.max(candidate.eventMs ?? 0, candidate.sentMs);
    if (OVER.includes(candidate.status)) continue;
    if (nowMs - refMs > sameEventHours(candidate.hazardType) * HOUR_MS) continue;
    const kept = newest.get(candidate.hazardType);
    if (kept === undefined || refMs > kept.refMs) newest.set(candidate.hazardType, { ...candidate, refMs });
  }
  return [...newest.values()]
    .sort((a, b) => b.refMs - a.refMs)
    .slice(0, MAX_OFFERS)
    .map((one) => ({
      ticketNumber: one.ticketNumber,
      hazardType: one.hazardType,
      hazardSubtype: one.hazardSubtype,
      eventTime: one.eventTime,
      sinceMs: one.eventMs ?? one.sentMs,
      reporters: one.reporters,
    }));
}
