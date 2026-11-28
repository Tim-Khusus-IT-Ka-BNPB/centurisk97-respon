import {
  addReply,
  type DeskPhoto,
  type DeskReportRecord,
  deskReport,
  facetCounts,
  galleryPhotos,
  logIdentityView,
  logTrackingLink,
  type MapPoint,
  mapPoints,
  markViewed,
  moveTicket,
  type QueueFilters,
  type QueueRow,
  queuePage,
  reportPhotos,
  sentPhoto,
} from "../adapters/postgres/desk";
import { eventOf } from "../adapters/postgres/events";
import { openMissingCount } from "../adapters/postgres/missingPersons";
import { referenceFile } from "../adapters/postgres/reports";
import { reportVideos } from "../adapters/postgres/videos";
import type {
  DeskEmergencies,
  DeskGallery,
  DeskIdentity,
  DeskMap,
  DeskQueue,
  DeskReport,
  DeskSummary,
  DeskTrackingLink,
} from "../contract/desk";
import type { Cluster } from "../domain/clusters";
import {
  DESK_PAGE_SIZE,
  type DeskHas,
  type DeskPeriod,
  GALLERY_PHOTOS,
  isOverdue,
  MAP_POINTS,
  periodStart,
} from "../domain/deskQueue";
import { type DeskCapability, mayUse } from "../domain/deskRights";
import { revisableOf } from "../domain/fieldCheck";
import type { EventTimeValue, FieldStates, PlaceValue } from "../domain/fieldState";
import { checkActions } from "../domain/handling";
import type { FieldError } from "../domain/identityForm";
import { impactOf } from "../domain/impact";
import { actionsFor, checkActionFile, type ResponseAction } from "../domain/responseActions";
import type { TicketStatus } from "../domain/stages";
import { checkMove, checkReply, moveCapability, noteRule, offeredStatuses } from "../domain/ticketMoves";
import type { StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { caseOfReport } from "./cases";
import { clusterMap } from "./clusters";
import { commentsFor } from "./comments";
import { at, draftZone } from "./draftView";
import { emergencyList } from "./emergency";
import { checkLimits, type LimitRefusal } from "./limits";
import { officersOf } from "./officers";
import { summaryGroups } from "./summary";
import { todayFor } from "./todayDesk";
import { trackingToken } from "./tracking";
import { versionsOf } from "./versions";

export type Refused =
  | { readonly kind: "notAllowed" }
  | { readonly kind: "notFound" }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

export type DeskAnswer<T> = { readonly kind: "ok"; readonly body: T } | Refused;

// Every desk service starts here: the role may do this, and the account is within its hourly limit.
export async function admitted(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  capability: DeskCapability,
  limit: "desk.read" | "desk.write" | "desk.alarm",
): Promise<Refused | null> {
  if (!mayUse(staff.role, capability)) return { kind: "notAllowed" };
  const refusal = await checkLimits(bindings, [[limit, { kind: "staff", staffId: staff.staffId }]]);
  return refusal ? { kind: "limit", refusal } : null;
}

// A sent report holds its place and the time of its event as values.
const fieldValue = <T>(states: QueueRow["states"], field: string): T =>
  (states[field] as { readonly value: unknown }).value as T;

// A reporter's name, number and post are for those who may read identity; others ask each time.
function queueItem(
  staff: StaffPrincipal,
  found: QueueRow,
  clusters: ReadonlyMap<string, Cluster>,
  nowMs: number,
): DeskQueue["items"][number] {
  const zone = draftZone(found.villageCode);
  const place = fieldValue<PlaceValue>(found.states, "place");
  return {
    ticketNumber: found.ticketNumber,
    status: found.status,
    hazardType: found.hazardType as DeskQueue["items"][number]["hazardType"],
    // One tap asks nothing, so its kind is not known.
    hazardSubtype: (found.states.hazardSubtype?.value as string | undefined) ?? "unknown",
    place: { villageName: place.villageName, districtName: place.districtName, regencyName: place.regencyName },
    eventTime: fieldValue<EventTimeValue>(found.states, "eventTime"),
    sentAt: at(found.sentAt, zone),
    completePercent: found.completePercent,
    photoCount: found.photoCount,
    reporter: { name: mayUse(staff.role, "readIdentity") ? found.reporterName : null, role: found.reporterRole },
    numberUnverified: found.numberUnverified,
    emergency: found.emergency,
    offline:
      found.offline === null
        ? null
        : {
            savedAt: found.offline.savedAt === null ? null : at(found.offline.savedAt, zone),
            late: found.offline.late,
          },
    taker: found.taker,
    news: found.news,
    overdue: isOverdue(found.status, found.statusSince.getTime(), nowMs),
    impact: impactOf(found.states),
    cluster: clusterView(clusters.get(found.ticketNumber)),
  };
}

const clusterView = (cluster: Cluster | undefined): DeskQueue["items"][number]["cluster"] =>
  cluster === undefined
    ? null
    : {
        tickets: [...cluster.tickets],
        reporters: cluster.reporters,
        strong: cluster.strong,
        sameVillage: cluster.sameVillage,
      };

export type QueueQuery = {
  readonly status: TicketStatus | null;
  readonly hazardType: string | null;
  readonly period: DeskPeriod;
  readonly ticketNumber: string | null;
  readonly has: DeskHas | null;
  readonly page: number;
};

const filtersOf = (
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  query: Omit<QueueQuery, "page">,
): QueueFilters => ({
  scope: staff.scope,
  status: query.status,
  hazardType: query.hazardType,
  sentFromMs: periodStart(query.period, bindings.clock.now()),
  ticketNumber: query.ticketNumber,
  has: query.has,
});

const pointView = (point: MapPoint): DeskMap["points"][number] => ({
  ...point,
  hazardType: point.hazardType as DeskMap["points"][number]["hazardType"],
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
    doubts: [...photo.doubts],
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
  const found = await mapPoints(bindings.db, filtersOf(bindings, staff, query), MAP_POINTS + 1);
  return {
    kind: "ok",
    body: {
      account: { label: staff.label },
      points: found.slice(0, MAP_POINTS).map(pointView),
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
  const found = await galleryPhotos(bindings.db, filtersOf(bindings, staff, query), GALLERY_PHOTOS + 1);
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
  const photo = await sentPhoto(bindings.db, staff.scope, photoId);
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
  const counts = await facetCounts(bindings.db, filtersOf(bindings, staff, query));
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
      emergencies: await emergencyList(bindings, staff),
      mayReadResponse: mayUse(staff.role, "readResponse"),
      missingOpen: await openMissingCount(bindings.db, staff.scope),
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
  const filters = filtersOf(bindings, staff, query);
  const [found, clusters] = await Promise.all([
    queuePage(bindings.db, filters, (query.page - 1) * DESK_PAGE_SIZE, DESK_PAGE_SIZE),
    clusterMap(bindings, staff.scope),
  ]);
  return {
    kind: "ok",
    body: {
      account: { label: staff.label },
      items: found.rows.map((row) => queueItem(staff, row, clusters, bindings.clock.now())),
      total: found.total,
      page: query.page,
      pageCount: Math.ceil(found.total / DESK_PAGE_SIZE),
    },
  };
}

const identityOf = (found: DeskReportRecord): DeskIdentity => ({
  name: found.reporterName,
  number: found.reporterNumber,
  officerRegency: found.officerRegency,
  officerPosition: found.officerPosition,
});

export const ENDED: readonly TicketStatus[] = ["closed", "invalid"];

// An officer with a profile of their own may take a report that is still open and in no one's hand.
const mayTake = (staff: StaffPrincipal, found: DeskReportRecord): boolean =>
  mayUse(staff.role, "takeReport") && staff.profile !== null && found.taker === null && !ENDED.includes(found.status);

// The actions offered for a hazard type. With no catalogue loaded only the officer's own words are.
export async function offeredActions(bindings: ServiceBindings, hazardType: string): Promise<ResponseAction[]> {
  return actionsFor(checkActionFile(await referenceFile(bindings.db, "responseActions")), hazardType);
}

async function eventView(bindings: ServiceBindings, staff: StaffPrincipal, ticketNumber: string) {
  const event = await eventOf(bindings.db, ticketNumber);
  return event === null
    ? null
    : { ...event, tickets: [...event.tickets], mayRelease: mayUse(staff.role, "releaseEvent") };
}

async function reportBody(bindings: ServiceBindings, staff: StaffPrincipal, ticketNumber: string) {
  const found = await deskReport(bindings.db, staff.scope, ticketNumber);
  if (found === null) return null;
  const zone = draftZone(found.villageCode);
  const states = found.states as FieldStates;
  const place = fieldValue<PlaceValue>(found.states, "place");
  const only = { status: null, hazardType: null, sentFromMs: null, ticketNumber, has: null };
  const [point] = await mapPoints(bindings.db, { scope: staff.scope, ...only }, 1);
  const body: DeskReport = {
    ...queueItem(staff, found, await clusterMap(bindings, staff.scope), bindings.clock.now()),
    account: { label: staff.label },
    event: await eventView(bindings, staff, ticketNumber),
    videos: (await reportVideos(bindings.db, ticketNumber)).map((video) => ({
      id: video.id,
      seconds: video.seconds,
      container: video.container,
      madeAt: video.made_at === null ? null : at(Date.parse(video.made_at), zone),
      // Kept together, so a latitude has its longitude.
      point: video.lat === null ? null : { lat: video.lat, lon: video.lon as number },
    })),
    reporter: {
      role: found.reporterRole,
      identity: mayUse(staff.role, "readIdentity") ? identityOf(found) : null,
    },
    officers: await officersOf(bindings, staff, found.villageCode, place),
    today: await todayFor(bindings, ticketNumber),
    comments: await commentsFor(bindings, ticketNumber),
    caseFile: await caseOfReport(bindings, staff, ticketNumber, found.villageCode.slice(0, 5)),
    point: point === undefined ? null : pointView(point),
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
      // Forwarding sends a report to the desk of its own place.
      forwardedTo: one.toStatus === "forwarded" && one.event === null ? place.regencyName : null,
      event: one.event,
      detail: one.detail,
    })),
    reporterWords: found.reporterWords.map((one) => ({ text: one.text, at: at(one.atMs, zone) })),
    photos: (await reportPhotos(bindings.db, ticketNumber)).map(photoView),
    newsStopped: found.newsStopped,
    versions: await versionsOf(bindings, ticketNumber, found.villageCode),
    nextStatuses: offeredStatuses(staff.role, found.status).map((status) => ({
      status,
      note: noteRule(found.status, status),
    })),
    revision: found.revision,
    mayTake: mayTake(staff, found),
    revisable: revisableOf(states),
    offeredActions: await offeredActions(bindings, found.hazardType),
    actions: found.handling.actions.map((one) => ({ label: one.label, at: at(one.atMs, zone), actor: one.staffLabel })),
    proofs: found.handling.proofs.map((one) => ({
      proofId: one.id,
      hasPoint: one.hasPoint,
      at: at(one.atMs, zone),
      actor: one.staffLabel,
      public: one.public,
      forwarded: one.forwarded,
    })),
    replies: found.replies.map((one) => ({
      text: one.text,
      at: at(one.atMs, zone),
      actor: one.staffLabel,
    })),
  };
  return body;
}

export async function deskEmergencies(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
): Promise<DeskAnswer<DeskEmergencies>> {
  const refused = await admitted(bindings, staff, "readQueue", "desk.alarm");
  if (refused) return refused;
  return { kind: "ok", body: { emergencies: await emergencyList(bindings, staff) } };
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
  if ((await deskReport(bindings.db, staff.scope, ticketNumber)) === null) return { kind: "notFound" };
  await markViewed(bindings.db, staff, ticketNumber, new Date(bindings.clock.now()));
  return { kind: "ok", body: (await reportBody(bindings, staff, ticketNumber)) as DeskReport };
}

// A regional officer asked who reported: logged, then shown this once.
export async function revealIdentity(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
): Promise<DeskAnswer<DeskIdentity>> {
  const refused = await admitted(bindings, staff, "revealIdentity", "desk.write");
  if (refused) return refused;
  const found = await deskReport(bindings.db, staff.scope, ticketNumber);
  if (found === null) return { kind: "notFound" };
  await logIdentityView(bindings.db, staff, ticketNumber, new Date(bindings.clock.now()));
  return { kind: "ok", body: identityOf(found) };
}

// The report's tracking link, for a reporter who calls having lost it: logged, then shown this once.
// The link is made again from the report, so nothing new is kept.
export async function giveTrackingLink(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
): Promise<DeskAnswer<DeskTrackingLink>> {
  const refused = await admitted(bindings, staff, "giveTrackingLink", "desk.write");
  if (refused) return refused;
  const found = await deskReport(bindings.db, staff.scope, ticketNumber);
  if (found === null) return { kind: "notFound" };
  await logTrackingLink(bindings.db, staff, ticketNumber, new Date(bindings.clock.now()));
  const token = await trackingToken(bindings.settings.keyHmacSecret, found.reportId);
  return { kind: "ok", body: { link: `${bindings.settings.appOrigin}/track#t=${token}` } };
}

export type DeskChange =
  | DeskAnswer<DeskReport>
  | { readonly kind: "invalid"; readonly error: FieldError }
  | { readonly kind: "transitionRefused" }
  // Another officer has it in hand.
  | { readonly kind: "taken"; readonly label: string }
  // Another officer moved it first; nothing of this change is written.
  | { readonly kind: "changed"; readonly status: TicketStatus };

// One change to a ticket: the account may make it and has calls left, its region holds the report,
// and the report is answered as it is after. A change that did not go in answers why.
export async function changeTicket(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  capability: DeskCapability,
  ticketNumber: string,
  change: (found: DeskReportRecord, at: Date) => Promise<DeskChange | null>,
): Promise<DeskChange> {
  const refused = await admitted(bindings, staff, capability, "desk.write");
  if (refused) return refused;
  const found = await deskReport(bindings.db, staff.scope, ticketNumber);
  if (found === null) return { kind: "notFound" };
  const outcome = await change(found, new Date(bindings.clock.now()));
  return outcome ?? { kind: "ok", body: (await reportBody(bindings, staff, ticketNumber)) as DeskReport };
}

export async function moveDeskTicket(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
  move: {
    readonly to: TicketStatus;
    readonly note: string;
    readonly revision: number;
    readonly actions: readonly string[];
    readonly otherAction: string;
  },
): Promise<DeskChange> {
  return changeTicket(bindings, staff, "moveTicket", ticketNumber, async (found, at) => {
    if (!mayUse(staff.role, moveCapability(found.status, move.to))) return { kind: "notAllowed" };
    if (found.revision !== move.revision) return { kind: "changed", status: found.status };
    const check = checkMove(found.status, move.to, move.note, found.handling.proofs.length);
    if (check.kind === "refused") return { kind: "transitionRefused" };
    if (check.kind === "invalid") return check;
    // Starting the work names what is being done (D112).
    const taken =
      move.to === "in_handling"
        ? checkActions(await offeredActions(bindings, found.hazardType), move.actions, move.otherAction)
        : ({ kind: "ok", actions: [] } as const);
    if (taken.kind === "invalid") return taken;
    const done = await moveTicket(
      bindings.db,
      staff,
      ticketNumber,
      { from: found.status, to: move.to, note: check.note, revision: move.revision, actions: taken.actions },
      at,
    );
    if (done) return null;
    const now = (await deskReport(bindings.db, staff.scope, ticketNumber)) as { readonly status: TicketStatus };
    return { kind: "changed", status: now.status };
  });
}

export async function replyToReporter(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
  typed: string,
): Promise<DeskChange> {
  return changeTicket(bindings, staff, "reply", ticketNumber, async (_found, at) => {
    const check = checkReply(typed);
    if (check.kind === "invalid") return check;
    await addReply(bindings.db, staff, ticketNumber, check.text, at);
    return null;
  });
}
