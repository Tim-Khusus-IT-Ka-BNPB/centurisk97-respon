import { type CandidateRow, districtReports } from "../adapters/postgres/sameEvent";
import { eventInstantMs } from "../domain/eventTime";
import type { EventTimeValue, FieldStates, PlaceValue } from "../domain/fieldState";
import type { HazardTypeId } from "../domain/hazards";
import { pickOffers } from "../domain/sameEvent";
import { DAY_MS } from "../domain/time";
import type { DraftContent, SameEvent } from "../domain/turn/content";
import type { TurnDraft } from "../domain/turn/engine";
import type { ServiceBindings } from "./bindings";
import { clusterMap } from "./clusters";

type States = Record<string, { readonly state: string; readonly value?: unknown }>;

// The longest window of any hazard (72 hours) bounds the read.
const LOOK_BACK_MS = 3 * DAY_MS;

const fieldValue = <T>(states: States, field: string): T | null =>
  states[field]?.state === "value" ? (states[field].value as T) : null;

export function candidateOf(row: CandidateRow, reporters: number) {
  const states = row.fields as States | null as States;
  const eventTime = fieldValue<EventTimeValue>(states, "eventTime");
  const subtype = fieldValue<string>(states, "hazardSubtype");
  return {
    ticketNumber: row.ticket_number,
    hazardType: row.hazard_type as HazardTypeId,
    hazardSubtype: subtype === "unknown" ? null : subtype,
    eventTime,
    eventMs: eventTime === null ? null : eventInstantMs(eventTime),
    sentMs: Date.parse(row.sent_at),
    status: row.status,
    reporters,
  };
}

// The reports to offer once the place is known: none for an emergency or news, or when none is near.
async function offersFor(bindings: ServiceBindings, content: DraftContent): Promise<SameEvent | null> {
  const states = content.states as FieldStates;
  const place = (states.place as { readonly value: PlaceValue }).value;
  const nowMs = bindings.clock.now();
  const [rows, clusters] = await Promise.all([
    districtReports(bindings.db, place.villageCode.slice(0, 8), new Date(nowMs - LOOK_BACK_MS)),
    clusterMap(bindings),
  ]);
  const offers = pickOffers(
    rows.map((row) => candidateOf(row, clusters.get(row.ticket_number)?.reporters ?? 1)),
    nowMs,
  );
  return offers.length === 0 ? null : { districtName: place.districtName, offers, answered: false, joined: null };
}

// On the turn that answers RT and RW, once per draft: a draft already past it goes on as it was.
export async function withSameEvent(
  bindings: ServiceBindings,
  before: TurnDraft,
  after: TurnDraft,
): Promise<TurnDraft> {
  const { content } = after;
  if (content.sameEvent !== undefined || content.emergency || content.followUp) return after;
  if (before.content.states.neighbourhood !== undefined || content.states.neighbourhood === undefined) return after;
  return { ...after, content: { ...content, sameEvent: await offersFor(bindings, content) } };
}
