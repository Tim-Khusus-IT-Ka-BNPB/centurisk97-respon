import type { TicketStatus } from "../../domain/stages";
import { atomically, type Database, empty, parsed, type Query, row, rows, sql } from "../../platform/database";
import type { StaffPrincipal } from "../../ports/identity";

export type QueueFilters = {
  readonly status: TicketStatus | null;
  readonly hazardType: string | null;
  readonly sentFromMs: number | null;
  readonly ticketNumber: string | null;
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
};

// The values shown are the first version's; later versions arrive with field checks and follow-ups.
const SELECT = sql`select r.ticket_number, t.status, r.hazard_type, r.village_code, r.sent_at, v.fields,
    v.complete_percent, v.reporter_name, v.reporter_role, r.number_unverified,
    (select count(*) from draft_photo p where p.draft_id = r.draft_id) as photo_count
  from report r
  join ticket t on t.report_id = r.id
  join report_version v on v.report_id = r.id and v.version = 1`;

function where(filters: QueueFilters): Query {
  const parts: Query[] = [];
  if (filters.status !== null) parts.push(sql`t.status = ${filters.status}`);
  if (filters.hazardType !== null) parts.push(sql`r.hazard_type = ${filters.hazardType}`);
  if (filters.sentFromMs !== null) parts.push(sql`r.sent_at >= ${new Date(filters.sentFromMs)}`);
  if (filters.ticketNumber !== null) parts.push(sql`r.ticket_number = ${filters.ticketNumber}`);
  return parts.reduce((joined, part, index) => (index === 0 ? sql` where ${part}` : sql`${joined} and ${part}`), empty);
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

export type DeskReportRecord = QueueRow & {
  readonly reporterNumber: string;
  readonly officerRegency: string | null;
  readonly officerPosition: string | null;
  readonly history: readonly {
    readonly toStatus: TicketStatus;
    readonly atMs: number;
    readonly actorLabel: string | null;
    readonly note: string | null;
  }[];
  readonly reporterWords: readonly { readonly text: string; readonly atMs: number }[];
};

export async function deskReport(db: Database, ticketNumber: string): Promise<DeskReportRecord | null> {
  const found = await row<
    QueueRecord & {
      draft_id: string;
      reporter_number: string;
      officer_regency: string | null;
      officer_position: string | null;
    }
  >(
    db,
    sql`select r.ticket_number, t.status, r.hazard_type, r.village_code, r.sent_at, v.fields,
        v.complete_percent, v.reporter_name, v.reporter_role, r.number_unverified, r.draft_id,
        v.reporter_number, v.officer_regency, v.officer_position,
        (select count(*) from draft_photo p where p.draft_id = r.draft_id) as photo_count
      from report r
      join ticket t on t.report_id = r.id
      join report_version v on v.report_id = r.id and v.version = 1
      where r.ticket_number = ${ticketNumber}`,
  );
  if (found === null) return null;
  const [history, words] = await Promise.all([
    rows<{ to_status: TicketStatus; at: string; actor_label: string | null; note: string | null }>(
      db,
      sql`select to_status, at, actor_label, note from ticket_history where ticket_number = ${ticketNumber} order by at, id`,
    ),
    rows<{ text_masked: string; created_at: string }>(
      db,
      sql`select text_masked, created_at from draft_message
        where draft_id = ${found.draft_id} and speaker = 'reporter' order by seq`,
    ),
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
    })),
    reporterWords: words.map((one) => ({ text: one.text_masked, atMs: Date.parse(one.created_at) })),
  };
}

const actionRow = (staff: StaffPrincipal, ticketNumber: string, action: "view", at: Date): Query =>
  sql`insert into staff_action (ticket_number, staff_id, staff_label, staff_kind, action, at)
    values (${ticketNumber}, ${staff.staffId}, ${staff.label}, ${staff.role}, ${action}, ${at})`;

// Opening a report: a ticket at "new" becomes "seen" with one history row by this officer, and
// the open is logged either way. When two officers open it at once only one moves it.
export async function markViewed(db: Database, staff: StaffPrincipal, ticketNumber: string, at: Date): Promise<void> {
  await atomically(db, [
    sql`update ticket set status = 'seen', updated_at = ${at} where ticket_number = ${ticketNumber} and status = 'new'`,
    sql`insert into ticket_history (ticket_number, from_status, to_status, actor, actor_id, actor_label, at)
      select ${ticketNumber}, 'new', 'seen', 'staff', ${staff.staffId}, ${staff.label}, ${at} where changes() = 1`,
    actionRow(staff, ticketNumber, "view", at),
  ]);
}
