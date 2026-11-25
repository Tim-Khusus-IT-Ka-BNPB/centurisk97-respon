import {
  type DeskPhoto,
  deskReport,
  facetCounts,
  galleryPhotos,
  mapPoints,
  markViewed,
  type QueueFilters,
  type QueueRow,
  queuePage,
  reportPhotos,
  sentPhoto,
} from "../adapters/d1/desk";
import type { DeskGallery, DeskMap, DeskQueue, DeskReport, DeskSummary } from "../contract/desk";
import {
  DESK_PAGE_SIZE,
  type DeskHas,
  type DeskPeriod,
  GALLERY_PHOTOS,
  MAP_POINTS,
  periodStart,
} from "../domain/deskQueue";
import { type DeskCapability, mayUse } from "../domain/deskRights";
import type { EventTimeValue, FieldStates, PlaceValue } from "../domain/fieldState";
import { impactOf } from "../domain/impact";
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
    impact: impactOf(found.states),
  };
}

export type QueueQuery = {
  readonly status: TicketStatus | null;
  readonly hazardType: string | null;
  readonly period: DeskPeriod;
  readonly ticketNumber: string | null;
  readonly has: DeskHas | null;
  readonly page: number;
};

const filtersOf = (bindings: ServiceBindings, query: Omit<QueueQuery, "page">): QueueFilters => ({
  status: query.status,
  hazardType: query.hazardType,
  sentFromMs: periodStart(query.period, bindings.clock.now()),
  ticketNumber: query.ticketNumber,
  has: query.has,
});

const photoView = (photo: DeskPhoto): DeskGallery["photos"][number] => {
  const zone = draftZone(photo.villageCode);
  return {
    photoId: photo.id,
    ticketNumber: photo.ticketNumber,
    badge: photo.badge,
    far: photo.far,
    takenAt: at(photo.takenAt, zone),
    receivedAt: at(photo.receivedAt, zone),
  };
};

// The filtered reports as points; one more than drawn is read to tell whether some were left out.
export async function deskMap(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  query: Omit<QueueQuery, "page">,
): Promise<DeskAnswer<DeskMap>> {
  const refused = await admitted(bindings, staff, "readQueue", "desk.read");
  if (refused) return refused;
  const found = await mapPoints(bindings.db, filtersOf(bindings, query), MAP_POINTS + 1);
  return {
    kind: "ok",
    body: {
      account: { label: staff.label },
      points: found.slice(0, MAP_POINTS).map((point) => ({
        ...point,
        hazardType: point.hazardType as DeskMap["points"][number]["hazardType"],
      })),
      cut: found.length > MAP_POINTS,
    },
  };
}

export async function deskGallery(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  query: Omit<QueueQuery, "page">,
): Promise<DeskAnswer<DeskGallery>> {
  const refused = await admitted(bindings, staff, "readQueue", "desk.read");
  if (refused) return refused;
  const found = await galleryPhotos(bindings.db, filtersOf(bindings, query), GALLERY_PHOTOS + 1);
  return {
    kind: "ok",
    body: {
      account: { label: staff.label },
      photos: found.slice(0, GALLERY_PHOTOS).map(photoView),
      cut: found.length > GALLERY_PHOTOS,
    },
  };
}

export type DeskPhotoFile = { readonly kind: "file"; readonly bytes: Uint8Array } | Refused;

// A sent report's photo for staff. A draft's photo, or a file gone from the store, is not found.
export async function deskPhotoFile(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  photoId: string,
): Promise<DeskPhotoFile> {
  const refused = await admitted(bindings, staff, "readReport", "desk.read");
  if (refused) return refused;
  const photo = await sentPhoto(bindings.db, photoId);
  const bytes = photo === null ? null : await bindings.photos.get(photo.storeKey);
  return bytes === null ? { kind: "notFound" } : { kind: "file", bytes };
}

const STATUSES = ["new", "seen", "under_review", "forwarded", "in_handling", "closed", "invalid"] as const;

// The counts behind the status queues and the hazard chips, every status listed even at 0.
export async function deskSummary(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  query: Omit<QueueQuery, "page">,
): Promise<DeskAnswer<DeskSummary>> {
  const refused = await admitted(bindings, staff, "readQueue", "desk.read");
  if (refused) return refused;
  const counts = await facetCounts(bindings.db, filtersOf(bindings, query));
  const byStatus = Object.fromEntries(STATUSES.map((status) => [status, counts.byStatus[status] ?? 0]));
  const total =
    query.status === null
      ? STATUSES.reduce((sum, status) => sum + (byStatus[status] as number), 0)
      : (byStatus[query.status] as number);
  return {
    kind: "ok",
    body: {
      account: { label: staff.label },
      total,
      byStatus: byStatus as DeskSummary["byStatus"],
      byHazard: counts.byHazard as DeskSummary["byHazard"],
      byHas: counts.byHas,
    },
  };
}

export async function deskQueue(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  query: QueueQuery,
): Promise<DeskAnswer<DeskQueue>> {
  const refused = await admitted(bindings, staff, "readQueue", "desk.read");
  if (refused) return refused;
  const filters = filtersOf(bindings, query);
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
    photos: (await reportPhotos(bindings.db, ticketNumber)).map(photoView),
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
