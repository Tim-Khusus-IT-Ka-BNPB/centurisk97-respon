import type { TicketStatus } from "../../domain/stages";
import { type Database, parsed, type Query, row, rows, sql } from "../../platform/database";

export type ReportRecord = {
  readonly id: string;
  readonly ticketNumber: string;
  readonly draftId: string;
  readonly reporterId: string | null;
  readonly numberKey: string;
  readonly ownerSlot: string;
  readonly hazardType: string;
  readonly villageCode: string;
  readonly sentAt: Date;
  readonly status: TicketStatus;
  // The first version's fields, as the summary showed them when sent.
  readonly states: Record<string, { state: string; value?: unknown }>;
  readonly reporterName: string;
  readonly rating: number | null;
  readonly photoCount: number;
  readonly history: readonly { readonly toStatus: TicketStatus; readonly atMs: number }[];
};

type ReportRow = {
  id: string;
  ticket_number: string;
  draft_id: string;
  reporter_id: string | null;
  number_key: string;
  owner_slot: string;
  hazard_type: string;
  village_code: string;
  sent_at: string;
  status: TicketStatus;
  fields: string;
  reporter_name: string;
  rating: number | null;
  photo_count: number;
};

const SELECT = sql`select r.id, r.ticket_number, r.draft_id, r.reporter_id, r.number_key, r.owner_slot, r.hazard_type, r.village_code,
    r.sent_at, t.status, v.fields, v.reporter_name, g.rating,
    (select count(*) from draft_photo p where p.draft_id = r.draft_id) as photo_count
  from report r
  join ticket t on t.report_id = r.id
  join report_version v on v.report_id = r.id and v.version = 1
  left join report_rating g on g.report_id = r.id`;

async function withHistory(db: Database, found: ReportRow | null): Promise<ReportRecord | null> {
  if (found === null) return null;
  const history = await rows<{ to_status: TicketStatus; at: string }>(
    db,
    sql`select to_status, at from ticket_history where ticket_number = ${found.ticket_number} order by at, id`,
  );
  return {
    id: found.id,
    ticketNumber: found.ticket_number,
    draftId: found.draft_id,
    reporterId: found.reporter_id,
    numberKey: found.number_key,
    ownerSlot: found.owner_slot,
    hazardType: found.hazard_type,
    villageCode: found.village_code,
    sentAt: new Date(found.sent_at),
    status: found.status,
    states: parsed<ReportRecord["states"]>(found.fields) as ReportRecord["states"],
    reporterName: found.reporter_name,
    rating: found.rating,
    photoCount: found.photo_count,
    history: history.map((one) => ({ toStatus: one.to_status, atMs: Date.parse(one.at) })),
  };
}

const one = async (db: Database, where: Query) =>
  withHistory(db, await row<ReportRow>(db, sql`${SELECT} where ${where}`));

export const reportByTrackingHash = (db: Database, hash: string) => one(db, sql`r.tracking_hash = ${hash}`);
export const reportByDraft = (db: Database, draftId: string) => one(db, sql`r.draft_id = ${draftId}`);
export const reportByTicket = (db: Database, ticketNumber: string) => one(db, sql`r.ticket_number = ${ticketNumber}`);

// Reports of one owner, newest first: a device's own, or every report of a session's number.
export async function ownReports(
  db: Database,
  owner: { readonly ownerSlot: string } | { readonly reporterId: string },
): Promise<
  { id: string; ticketNumber: string; hazardType: string; villageCode: string; sentAt: Date; status: TicketStatus }[]
> {
  const where =
    "ownerSlot" in owner ? sql`r.owner_slot = ${owner.ownerSlot}` : sql`r.reporter_id = ${owner.reporterId}`;
  const found = await rows<{
    id: string;
    ticket_number: string;
    hazard_type: string;
    village_code: string;
    sent_at: string;
    status: TicketStatus;
  }>(
    db,
    sql`select r.id, r.ticket_number, r.hazard_type, r.village_code, r.sent_at, t.status
      from report r join ticket t on t.report_id = r.id where ${where} order by r.sent_at desc, r.ticket_number desc`,
  );
  return found.map((report) => ({
    id: report.id,
    ticketNumber: report.ticket_number,
    hazardType: report.hazard_type,
    villageCode: report.village_code,
    sentAt: new Date(report.sent_at),
    status: report.status,
  }));
}

// A new rating replaces the old one.
export const rateReport = (reportId: string, rating: number, at: Date): Query =>
  sql`insert into report_rating (report_id, rating, rated_at) values (${reportId}, ${rating}, ${at})
    on conflict (report_id) do update set rating = excluded.rating, rated_at = excluded.rated_at`;

// A small reference file as last imported, or null when none is.
export async function referenceFile(db: Database, name: "bpbdContacts" | "education"): Promise<unknown | null> {
  const found = await row<{ body: string }>(db, sql`select body from reference_file where name = ${name}`);
  return found ? JSON.parse(found.body) : null;
}
