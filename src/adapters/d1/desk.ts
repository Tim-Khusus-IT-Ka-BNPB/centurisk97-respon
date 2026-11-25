import { DESK_HAS, type DeskHas } from "../../domain/deskQueue";
import type { StaffScope } from "../../domain/deskRights";
import type { EmergencyKind, VictimAnswer } from "../../domain/emergency";
import type { Change, CheckResult } from "../../domain/fieldCheck";
import type { TakenAction } from "../../domain/handling";
import type { TicketStatus } from "../../domain/stages";
import {
  atomically,
  changedOne,
  type Database,
  empty,
  parsed,
  type Query,
  row,
  rows,
  run,
  sql,
} from "../../platform/database";
import type { StaffPrincipal } from "../../ports/identity";
import { actionRow, regionParts } from "./deskShared";
import { actionRows, type Handling, handlingOf, historyEvent } from "./handling";
import { historyNotice, IF_WRITTEN, newsState, replyNotice } from "./news";

// Every read names the region it may read: a report outside it is as if it were not there (D95).
export type QueueFilters = {
  readonly scope: StaffScope;
  readonly status: TicketStatus | null;
  readonly hazardType: string | null;
  readonly sentFromMs: number | null;
  readonly ticketNumber: string | null;
  readonly has: DeskHas | null;
};

export type QueueRow = {
  readonly ticketNumber: string;
  readonly status: TicketStatus;
  readonly hazardType: string;
  readonly villageCode: string;
  readonly sentAt: Date;
  readonly states: Record<string, { state: string; value?: unknown }>;
  readonly completePercent: number;
  readonly photoCount: number;
  readonly reporterName: string;
  readonly reporterRole: "citizen" | "claimedOfficer";
  readonly numberUnverified: boolean;
  readonly emergency: { readonly kind: EmergencyKind; readonly victims: VictimAnswer } | null;
  readonly taker: string | null;
  // The reporter added news that no officer has acted on yet.
  readonly news: boolean;
};

type QueueRecord = {
  ticket_number: string;
  status: TicketStatus;
  hazard_type: string;
  village_code: string;
  sent_at: string;
  fields: string;
  complete_percent: number;
  photo_count: number;
  reporter_name: string;
  reporter_role: "citizen" | "claimedOfficer";
  number_unverified: number;
  emergency: EmergencyKind | null;
  emergency_victims: VictimAnswer | null;
  taker: string | null;
  news: number;
};

// The values shown are the newest version's: a field check's corrections make one.
const LATEST = sql`(select max(m.version) from report_version m where m.report_id = r.id)`;

// News from the reporter that nothing was done about since: reading a report, or taking a copy of
// it, is not acting on it.
const NEWS = sql`exists (select 1 from ticket_history n where n.ticket_number = r.ticket_number and n.event = 'followUp'
    and not exists (select 1 from staff_action a where a.ticket_number = n.ticket_number and a.at > n.at
      and a.action not in ('view', 'identityView', 'document', 'documentPack')))`;

const SELECT = sql`select r.ticket_number, t.status, r.hazard_type, r.village_code, r.sent_at, v.fields,
    v.complete_percent, v.reporter_name, v.reporter_role, r.number_unverified, r.emergency, r.emergency_victims,
    (select k.label from report_taker k where k.ticket_number = r.ticket_number) as taker, ${NEWS} as news,
    (select count(*) from draft_photo p where p.draft_id = r.draft_id) as photo_count
  from report r
  join ticket t on t.report_id = r.id
  join report_version v on v.report_id = r.id and v.version = ${LATEST}`;

// A count above zero in the newest version's values: not known and none are both left out (HF2).
const anyAbove = (...paths: Query[]): Query =>
  sql`exists (select 1 from report_version h where h.report_id = r.id and h.version = ${LATEST} and (${paths.reduce(
    (joined, path) => sql`${joined} or ${path}`,
  )}))`;

const HAS: Readonly<Record<DeskHas, Query>> = {
  victims: anyAbove(
    sql`json_extract(h.fields, '$.dead.value') > 0`,
    sql`json_extract(h.fields, '$.missing.value') > 0`,
    sql`json_extract(h.fields, '$.injured.value') > 0`,
  ),
  displaced: anyAbove(sql`json_extract(h.fields, '$.displacedPeople.value') > 0`),
  houses: anyAbove(
    sql`json_extract(h.fields, '$.housesHeavy.value') > 0`,
    sql`json_extract(h.fields, '$.housesModerate.value') > 0`,
    sql`json_extract(h.fields, '$.housesLight.value') > 0`,
  ),
  photos: sql`exists (select 1 from draft_photo h where h.draft_id = r.draft_id)`,
  news: NEWS,
};

const whereAll = (parts: readonly Query[]): Query =>
  parts.reduce((joined, part, index) => (index === 0 ? sql` where ${part}` : sql`${joined} and ${part}`), empty);

// The filters as a where clause, with any further conditions a query needs.
function where(filters: QueueFilters, ...more: Query[]): Query {
  const parts: Query[] = [...regionParts(filters.scope), ...more];
  if (filters.status !== null) parts.push(sql`t.status = ${filters.status}`);
  if (filters.hazardType !== null) parts.push(sql`r.hazard_type = ${filters.hazardType}`);
  if (filters.sentFromMs !== null) parts.push(sql`r.sent_at >= ${new Date(filters.sentFromMs)}`);
  if (filters.ticketNumber !== null) parts.push(sql`r.ticket_number = ${filters.ticketNumber}`);
  if (filters.has !== null) parts.push(HAS[filters.has]);
  return whereAll(parts);
}

const queueRow = (found: QueueRecord): QueueRow => ({
  ticketNumber: found.ticket_number,
  status: found.status,
  hazardType: found.hazard_type,
  villageCode: found.village_code,
  sentAt: new Date(found.sent_at),
  states: parsed<QueueRow["states"]>(found.fields) as QueueRow["states"],
  completePercent: found.complete_percent,
  photoCount: found.photo_count,
  reporterName: found.reporter_name,
  reporterRole: found.reporter_role,
  numberUnverified: found.number_unverified === 1,
  taker: found.taker,
  news: found.news === 1,
  emergency:
    found.emergency === null ? null : { kind: found.emergency, victims: found.emergency_victims as VictimAnswer },
});

// One page of sent reports, newest first, and how many match in all.
export async function queuePage(
  db: Database,
  filters: QueueFilters,
  offset: number,
  limit: number,
): Promise<{ rows: QueueRow[]; total: number }> {
  const filter = where(filters);
  const [found, counted] = await Promise.all([
    rows<QueueRecord>(
      db,
      sql`${SELECT}${filter} order by r.sent_at desc, r.ticket_number desc limit ${limit} offset ${offset}`,
    ),
    row<{ total: number }>(
      db,
      sql`select count(*) as total from report r join ticket t on t.report_id = r.id${filter}`,
    ),
  ]);
  return { rows: found.map(queueRow), total: (counted as { total: number }).total };
}

type HistoryEvent = "fieldCheck" | "actions" | "take" | "followUp";

// What a check found and put right, what was done, or what the reporter added.
type HistoryDetail = {
  readonly result?: CheckResult;
  readonly changes?: readonly Change[];
  readonly actions?: readonly string[];
  readonly taker?: string;
  // The version the reporter's news made.
  readonly version?: number;
};

export type DeskReportRecord = QueueRow & {
  readonly reporterNumber: string;
  readonly officerRegency: string | null;
  readonly officerPosition: string | null;
  readonly history: readonly {
    readonly toStatus: TicketStatus;
    readonly atMs: number;
    readonly actorLabel: string | null;
    readonly note: string | null;
    readonly event: HistoryEvent | null;
    readonly detail: HistoryDetail | null;
  }[];
  readonly reporterWords: readonly { readonly text: string; readonly atMs: number }[];
  readonly replies: readonly { readonly text: string; readonly atMs: number; readonly staffLabel: string }[];
  // Grows with every status change; a change names the one it read.
  readonly revision: number;
  readonly reportId: string;
  readonly handling: Handling;
  // The reporter asked to be told no more of this report.
  readonly newsStopped: boolean;
};

export async function deskReport(
  db: Database,
  scope: StaffScope,
  ticketNumber: string,
): Promise<DeskReportRecord | null> {
  const found = await row<
    QueueRecord & {
      draft_id: string;
      reporter_number: string;
      officer_regency: string | null;
      officer_position: string | null;
      revision: number;
      report_id: string;
    }
  >(
    db,
    sql`select r.ticket_number, t.status, r.hazard_type, r.village_code, r.sent_at, v.fields,
        v.complete_percent, v.reporter_name, v.reporter_role, r.number_unverified, r.emergency, r.emergency_victims,
    (select k.label from report_taker k where k.ticket_number = r.ticket_number) as taker, ${NEWS} as news, r.draft_id, r.id as report_id, t.revision,
        v.reporter_number, v.officer_regency, v.officer_position,
        (select count(*) from draft_photo p where p.draft_id = r.draft_id) as photo_count
      from report r
      join ticket t on t.report_id = r.id
      join report_version v on v.report_id = r.id and v.version = ${LATEST}
      ${whereAll([sql`r.ticket_number = ${ticketNumber}`, ...regionParts(scope)])}`,
  );
  if (found === null) return null;
  const [history, words, replies, handling, news] = await Promise.all([
    rows<{
      to_status: TicketStatus;
      at: string;
      actor_label: string | null;
      note: string | null;
      event: HistoryEvent | null;
      detail: string | null;
    }>(
      db,
      sql`select to_status, at, actor_label, note, event, detail from ticket_history where ticket_number = ${ticketNumber} order by at, id`,
    ),
    rows<{ text_masked: string; created_at: string }>(
      db,
      sql`select text_masked, created_at from draft_message
        where speaker = 'reporter' and draft_id in (
          select ${found.draft_id}
          union all select d.id from report_draft d where d.follow_up_of = ${found.report_id} and d.state = 'sent')
        order by created_at, draft_id, seq`,
    ),
    rows<{ text: string; staff_label: string; at: string }>(
      db,
      sql`select text, staff_label, at from report_reply where ticket_number = ${ticketNumber} order by at, id`,
    ),
    handlingOf(db, ticketNumber),
    newsState(db, ticketNumber),
  ]);
  return {
    ...queueRow(found),
    reporterNumber: found.reporter_number,
    officerRegency: found.officer_regency,
    officerPosition: found.officer_position,
    history: history.map((one) => ({
      toStatus: one.to_status,
      atMs: Date.parse(one.at),
      actorLabel: one.actor_label,
      note: one.note,
      event: one.event,
      detail: parsed<HistoryDetail>(one.detail),
    })),
    reporterWords: words.map((one) => ({ text: one.text_masked, atMs: Date.parse(one.created_at) })),
    replies: replies.map((one) => ({ text: one.text, atMs: Date.parse(one.at), staffLabel: one.staff_label })),
    revision: found.revision,
    reportId: found.report_id,
    handling,
    newsStopped: news.stopped,
  };
}

type Move = { readonly from: TicketStatus; readonly to: TicketStatus; readonly note: string | null };

// The ticket moved from the status it is at.
const moveRow = (ticketNumber: string, { from, to }: Move, at: Date): Query =>
  sql`update ticket set status = ${to}, revision = revision + 1, updated_at = ${at}
    where ticket_number = ${ticketNumber} and status = ${from}`;

// Its history row, written only when the move before it changed the ticket.
const historyRow = (staff: StaffPrincipal, ticketNumber: string, { from, to, note }: Move, at: Date): Query =>
  sql`insert into ticket_history (ticket_number, from_status, to_status, actor, actor_id, actor_label, note, at)
    select ${ticketNumber}, ${from}, ${to}, 'staff', ${staff.staffId}, ${staff.label}, ${note}, ${at} where changes() = 1`;

const SEEN: Move = { from: "new", to: "seen", note: null };
const REVIEWED: Move = { from: "seen", to: "under_review", note: null };

// Opening a report: a ticket at "new" becomes "seen" with one history row by this officer, and
// the open is logged either way. When two officers open it at once only one moves it.
export async function markViewed(db: Database, staff: StaffPrincipal, ticketNumber: string, at: Date): Promise<void> {
  await atomically(db, [
    moveRow(ticketNumber, SEEN, at),
    historyRow(staff, ticketNumber, SEEN, at),
    historyNotice(ticketNumber, "status", at, IF_WRITTEN),
    actionRow(staff, ticketNumber, "view", at),
  ]);
}

// A regional officer asked for the reporter's identity: who, when and which report.
export async function logIdentityView(
  db: Database,
  staff: StaffPrincipal,
  ticketNumber: string,
  at: Date,
): Promise<void> {
  await run(db, actionRow(staff, ticketNumber, "identityView", at));
}

// A document of a report left the desk: who took it, when and which report.
export async function logDocument(
  db: Database,
  staff: StaffPrincipal,
  ticketNumber: string,
  action: "document" | "documentPack",
  at: Date,
): Promise<void> {
  await run(db, actionRow(staff, ticketNumber, action, at));
}

// The ticket, its history row and the log together, or nothing: false when another officer
// changed the ticket after this one read it.
export async function moveTicket(
  db: Database,
  staff: StaffPrincipal,
  ticketNumber: string,
  move: Move & { readonly revision: number; readonly actions: readonly TakenAction[] },
  at: Date,
): Promise<boolean> {
  const { actions } = move;
  const done = await atomically(db, [
    sql`${moveRow(ticketNumber, move, at)} and revision = ${move.revision}`,
    historyRow(staff, ticketNumber, move, at),
    changedOne,
    historyNotice(ticketNumber, "status", at),
    actionRow(staff, ticketNumber, "status", at),
    // What is being done, told with the move that starts it.
    ...(actions.length === 0
      ? []
      : [
          historyEvent(staff, ticketNumber, move.to, actions, at),
          historyNotice(ticketNumber, "actions", at),
          ...actionRows(staff, ticketNumber, actions, at),
        ]),
  ]);
  return done !== null;
}

// A reply, kept as written. Writing one means the report was seen and is being looked at, so a
// ticket not yet under review moves there.
export async function addReply(
  db: Database,
  staff: StaffPrincipal,
  ticketNumber: string,
  text: string,
  at: Date,
): Promise<void> {
  await atomically(db, [
    moveRow(ticketNumber, SEEN, at),
    historyRow(staff, ticketNumber, SEEN, at),
    historyNotice(ticketNumber, "status", at, IF_WRITTEN),
    moveRow(ticketNumber, REVIEWED, at),
    historyRow(staff, ticketNumber, REVIEWED, at),
    historyNotice(ticketNumber, "status", at, IF_WRITTEN),
    sql`insert into report_reply (ticket_number, staff_id, staff_label, text, at)
      values (${ticketNumber}, ${staff.staffId}, ${staff.label}, ${text}, ${at})`,
    replyNotice(ticketNumber, at),
    actionRow(staff, ticketNumber, "reply", at),
  ]);
}

export type MapPoint = {
  readonly ticketNumber: string;
  readonly status: TicketStatus;
  readonly hazardType: string;
  readonly villageName: string;
  readonly precision: "gpsPoint" | "estimate" | "villageLevel";
  readonly emergency: boolean;
  readonly lat: number;
  readonly lon: number;
};

// Every filtered report as a point, newest first: its GPS reading, or for a village picked by
// search the centre of that village's outline in the active place snapshot. A report whose
// village has no outline there has no point to draw and is left out.
export async function mapPoints(db: Database, filters: QueueFilters, limit: number): Promise<MapPoint[]> {
  const found = await rows<{
    ticket_number: string;
    status: TicketStatus;
    hazard_type: string;
    village_name: string;
    precision: MapPoint["precision"];
    emergency: string | null;
    lat: number;
    lon: number;
  }>(
    db,
    sql`select r.ticket_number, t.status, r.hazard_type, r.emergency,
        json_extract(v.fields, '$.place.value.villageName') as village_name,
        json_extract(v.fields, '$.place.value.precision') as precision,
        coalesce(json_extract(v.fields, '$.place.value.point.lat'), s.centre_lat) as lat,
        coalesce(json_extract(v.fields, '$.place.value.point.lon'), s.centre_lon) as lon
      from report r
      join ticket t on t.report_id = r.id
      join report_version v on v.report_id = r.id and v.version = ${LATEST}
      left join place_snapshot p on p.active = 1
      left join place_village_shape s on s.snapshot_id = p.id and s.code = r.village_code
      ${where(filters, sql`coalesce(json_extract(v.fields, '$.place.value.point.lat'), s.centre_lat) is not null`)}
      order by r.sent_at desc, r.ticket_number desc limit ${limit}`,
  );
  return found.map((one) => ({
    ticketNumber: one.ticket_number,
    status: one.status,
    hazardType: one.hazard_type,
    villageName: one.village_name,
    precision: one.precision,
    emergency: one.emergency !== null,
    lat: one.lat,
    lon: one.lon,
  }));
}

export type DeskPhoto = {
  readonly id: string;
  readonly ticketNumber: string;
  readonly storeKey: string;
  readonly villageCode: string;
  readonly badge: "deviceGps" | "photoData" | "none";
  readonly far: boolean;
  readonly takenAt: Date;
  readonly receivedAt: Date;
};

type PhotoRow = {
  id: string;
  ticket_number: string;
  store_key: string;
  village_code: string;
  badge: DeskPhoto["badge"];
  far: number;
  taken_at: string;
  received_at: string;
};

const PHOTO_SELECT = sql`select p.id, r.ticket_number, p.store_key, r.village_code, p.badge, p.far, p.taken_at, p.received_at
  from draft_photo p
  join report r on r.draft_id = p.draft_id
  join ticket t on t.report_id = r.id`;

const deskPhoto = (one: PhotoRow): DeskPhoto => ({
  id: one.id,
  ticketNumber: one.ticket_number,
  storeKey: one.store_key,
  villageCode: one.village_code,
  badge: one.badge,
  far: one.far === 1,
  // Every kept photo has a time: the camera's, the device reading's, or its upload.
  takenAt: new Date(one.taken_at),
  receivedAt: new Date(one.received_at),
});

// Photos of the filtered sent reports, newest first.
export async function galleryPhotos(db: Database, filters: QueueFilters, limit: number): Promise<DeskPhoto[]> {
  const found = await rows<PhotoRow>(
    db,
    sql`${PHOTO_SELECT}${where(filters)} order by p.received_at desc, p.id limit ${limit}`,
  );
  return found.map(deskPhoto);
}

export async function reportPhotos(db: Database, ticketNumber: string): Promise<DeskPhoto[]> {
  const found = await rows<PhotoRow>(
    db,
    sql`${PHOTO_SELECT} where r.ticket_number = ${ticketNumber} order by p.received_at, p.id`,
  );
  return found.map(deskPhoto);
}

// A photo of a sent report; a draft's photo is not on the desk.
export async function sentPhoto(db: Database, scope: StaffScope, photoId: string): Promise<DeskPhoto | null> {
  const found = await row<PhotoRow>(
    db,
    sql`${PHOTO_SELECT}${whereAll([sql`p.id = ${photoId}`, ...regionParts(scope)])}`,
  );
  return found === null ? null : deskPhoto(found);
}

// Reports per status, per hazard type and per holding, each under every filter but its own, so
// each count says what picking it would show.
export async function facetCounts(
  db: Database,
  filters: QueueFilters,
): Promise<{ byStatus: Record<string, number>; byHazard: Record<string, number>; byHas: Record<DeskHas, number> }> {
  const holding = async (has: DeskHas) => {
    const counted = await row<{ total: number }>(
      db,
      sql`select count(*) as total from report r join ticket t on t.report_id = r.id${where({ ...filters, has })}`,
    );
    return [has, (counted as { total: number }).total] as const;
  };
  const [statuses, hazards, ...held] = await Promise.all([
    rows<{ status: string; total: number }>(
      db,
      sql`select t.status, count(*) as total from report r join ticket t on t.report_id = r.id${where({ ...filters, status: null })}
        group by t.status`,
    ),
    rows<{ hazard_type: string; total: number }>(
      db,
      sql`select r.hazard_type, count(*) as total from report r join ticket t on t.report_id = r.id${where({ ...filters, hazardType: null })}
        group by r.hazard_type`,
    ),
    ...DESK_HAS.map(holding),
  ]);
  return {
    byStatus: Object.fromEntries(statuses.map((one) => [one.status, one.total])),
    byHazard: Object.fromEntries(hazards.map((one) => [one.hazard_type, one.total])),
    byHas: Object.fromEntries(held) as Record<DeskHas, number>,
  };
}
