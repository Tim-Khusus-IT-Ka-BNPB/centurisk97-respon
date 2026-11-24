import { deskReport, markViewed, type QueueFilters, type QueueRow, queuePage } from "../adapters/d1/desk";
import type { DeskQueue, DeskReport } from "../contract/desk";
import { DESK_PAGE_SIZE, type DeskPeriod, periodStart } from "../domain/deskQueue";
import { type DeskCapability, mayUse } from "../domain/deskRights";
import type { EventTimeValue, FieldStates, PlaceValue } from "../domain/fieldState";
import type { TicketStatus } from "../domain/stages";
import type { StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { at, draftZone } from "./draftView";
import { checkLimits, type LimitRefusal } from "./limits";
import { summaryGroups } from "./summary";

type Refused =
  | { readonly kind: "notAllowed" }
  | { readonly kind: "notFound" }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

export type DeskAnswer<T> = { readonly kind: "ok"; readonly body: T } | Refused;

// Every desk service starts here: the role may do this, and the account is within its hourly limit.
async function admitted(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  capability: DeskCapability,
  limit: "desk.read" | "desk.write",
): Promise<Refused | null> {
  if (!mayUse(staff.role, capability)) return { kind: "notAllowed" };
  const refusal = await checkLimits(bindings, [[limit, { kind: "staff", staffId: staff.staffId }]]);
  return refusal ? { kind: "limit", refusal } : null;
}

// A sent report holds every required field as a value: the place, the subtype and the event time.
const fieldValue = <T>(states: QueueRow["states"], field: string): T =>
  (states[field] as { readonly value: unknown }).value as T;

function queueItem(found: QueueRow): DeskQueue["items"][number] {
  const zone = draftZone(found.villageCode);
  const place = fieldValue<PlaceValue>(found.states, "place");
  return {
    ticketNumber: found.ticketNumber,
    status: found.status,
    hazardType: found.hazardType as DeskQueue["items"][number]["hazardType"],
    hazardSubtype: fieldValue<string>(found.states, "hazardSubtype"),
    place: { villageName: place.villageName, districtName: place.districtName, regencyName: place.regencyName },
    eventTime: fieldValue<EventTimeValue>(found.states, "eventTime"),
    sentAt: at(found.sentAt, zone),
    completePercent: found.completePercent,
    photoCount: found.photoCount,
    reporter: { name: found.reporterName, role: found.reporterRole },
    numberUnverified: found.numberUnverified,
  };
}

export type QueueQuery = {
  readonly status: TicketStatus | null;
  readonly hazardType: string | null;
  readonly period: DeskPeriod;
  readonly ticketNumber: string | null;
  readonly page: number;
};

export async function deskQueue(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  query: QueueQuery,
): Promise<DeskAnswer<DeskQueue>> {
  const refused = await admitted(bindings, staff, "readQueue", "desk.read");
  if (refused) return refused;
  const filters: QueueFilters = {
    status: query.status,
    hazardType: query.hazardType,
    sentFromMs: periodStart(query.period, bindings.clock.now()),
    ticketNumber: query.ticketNumber,
  };
  const found = await queuePage(bindings.db, filters, (query.page - 1) * DESK_PAGE_SIZE, DESK_PAGE_SIZE);
  return {
    kind: "ok",
    body: {
      account: { label: staff.label },
      items: found.rows.map(queueItem),
      total: found.total,
      page: query.page,
      pageCount: Math.ceil(found.total / DESK_PAGE_SIZE),
    },
  };
}

async function reportBody(bindings: ServiceBindings, staff: StaffPrincipal, ticketNumber: string) {
  const found = await deskReport(bindings.db, ticketNumber);
  if (found === null) return null;
  const zone = draftZone(found.villageCode);
  const states = found.states as FieldStates;
  const body: DeskReport = {
    ...queueItem(found),
    account: { label: staff.label },
    reporter: {
      name: found.reporterName,
      role: found.reporterRole,
      number: found.reporterNumber,
      officerRegency: found.officerRegency,
      officerPosition: found.officerPosition,
    },
    groups: summaryGroups(states).map((group) => ({
      ...group,
      rows: group.rows.map((one) => {
        const state = states[one.fieldId as keyof FieldStates];
        return { ...one, quote: state !== undefined && "quote" in state ? state.quote : null };
      }),
    })),
    history: found.history.map((one) => ({
      status: one.toStatus,
      at: at(one.atMs, zone),
      actor: one.actorLabel,
      note: one.note,
    })),
    reporterWords: found.reporterWords.map((one) => ({ text: one.text, at: at(one.atMs, zone) })),
  };
  return body;
}

// A GET never writes: reading a report does not mark it seen.
export async function readDeskReport(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
): Promise<DeskAnswer<DeskReport>> {
  const refused = await admitted(bindings, staff, "readReport", "desk.read");
  if (refused) return refused;
  const body = await reportBody(bindings, staff, ticketNumber);
  return body === null ? { kind: "notFound" } : { kind: "ok", body };
}

// The officer opened the report: logged, and a new ticket becomes seen.
export async function viewDeskReport(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
): Promise<DeskAnswer<DeskReport>> {
  const refused = await admitted(bindings, staff, "markSeen", "desk.write");
  if (refused) return refused;
  if ((await deskReport(bindings.db, ticketNumber)) === null) return { kind: "notFound" };
  await markViewed(bindings.db, staff, ticketNumber, new Date(bindings.clock.now()));
  return { kind: "ok", body: (await reportBody(bindings, staff, ticketNumber)) as DeskReport };
}
