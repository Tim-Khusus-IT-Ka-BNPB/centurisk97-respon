import type { EmergencyKind, VictimAnswer } from "../../domain/emergency";
import type { DraftContent } from "../../domain/turn/content";
import { type Database, type Query, row, sql } from "../../platform/database";

export async function sentTicket(
  db: Database,
  draftId: string,
): Promise<{ ticketNumber: string; sentAt: Date } | null> {
  const found = await row<{ ticket_number: string; sent_at: string }>(
    db,
    sql`select ticket_number, sent_at from report where draft_id = ${draftId}`,
  );
  return found ? { ticketNumber: found.ticket_number, sentAt: new Date(found.sent_at) } : null;
}

const sendsSince = (numberKey: string, ownerSlot: string, since: Date) =>
  sql`from report where number_key = ${numberKey} and owner_slot = ${ownerSlot} and sent_at > ${since}`;

// Sends counted for the rolling limit: this number in this slot over the last 24 hours.
export async function recentSends(
  db: Database,
  numberKey: string,
  ownerSlot: string,
  since: Date,
): Promise<{ count: number; oldest: Date | null }> {
  const found = (await row<{ count: number; oldest: string | null }>(
    db,
    sql`select count(*) as count, min(sent_at) as oldest ${sendsSince(numberKey, ownerSlot, since)}`,
  )) as { count: number; oldest: string | null };
  return { count: found.count, oldest: found.oldest === null ? null : new Date(found.oldest) };
}

// The same count inside the send batch, so two sends of one number cannot both pass the limit.
export const sendsBelow = (numberKey: string, ownerSlot: string, since: Date, max: number): Query =>
  sql`(select count(*) ${sendsSince(numberKey, ownerSlot, since)}) < ${max}`;

// The day's next ticket sequence, raised inside the send batch so a rolled back send uses none.
export const nextSequence = (wibDate: string): Query =>
  sql`insert into ticket_day_counter (wib_date, last_n) values (${wibDate}, 1)
    on conflict (wib_date) do update set last_n = last_n + 1`;

// The ticket number the counter just gave: the day's prefix and the sequence, at least two digits.
export const ticketNumberOf = (prefix: string, wibDate: string): Query =>
  sql`(${prefix} || '-' || printf('%02d', (select last_n from ticket_day_counter where wib_date = ${wibDate})))`;

export type NewReport = {
  readonly reportId: string;
  // SHA-256 of the tracking link's secret, made from the report id.
  readonly trackingHash: string;
  readonly ticketNumber: Query;
  readonly draftId: string;
  readonly reporterId: string;
  readonly numberKey: string;
  readonly ownerSlot: string;
  readonly numberUnverified: boolean;
  readonly hazardType: string;
  readonly villageCode: string;
  readonly sentAt: Date;
  readonly content: DraftContent;
  readonly reporter: {
    readonly name: string;
    readonly number: string;
    readonly role: string;
    readonly officerRegency: string | null;
    readonly officerPosition: string | null;
  };
  readonly consent: { readonly privacyVersion: number; readonly agreedAt: Date };
  readonly completePercent: number;
  readonly emergency: { readonly kind: EmergencyKind; readonly victims: VictimAnswer } | null;
};

// Report, its first version, the ticket at "new" and its first history row, as one part of the send batch.
export function insertReport(report: NewReport): Query[] {
  const code = report.villageCode;
  const { reportId } = report;
  const ticket = sql`(select ticket_number from report where id = ${reportId})`;
  const who = report.reporter;
  return [
    sql`insert into report (id, ticket_number, draft_id, reporter_id, number_key, owner_slot, number_unverified, hazard_type,
        village_code, district_code, regency_code, province_code, sent_at, tracking_hash, emergency, emergency_victims)
      values (${reportId}, ${report.ticketNumber}, ${report.draftId}, ${report.reporterId}, ${report.numberKey},
        ${report.ownerSlot}, ${report.numberUnverified}, ${report.hazardType}, ${code}, ${code.slice(0, 8)},
        ${code.slice(0, 5)}, ${code.slice(0, 2)}, ${report.sentAt}, ${report.trackingHash},
        ${report.emergency?.kind ?? null}, ${report.emergency?.victims ?? null})
      returning ticket_number`,
    sql`insert into report_version (report_id, version, fields, reporter_name, reporter_number, reporter_role,
        officer_regency, officer_position, privacy_version, consent_agreed_at, complete_percent, created_at)
      values (${reportId}, 1, ${report.content.states}, ${who.name}, ${who.number}, ${who.role},
        ${who.officerRegency}, ${who.officerPosition}, ${report.consent.privacyVersion}, ${report.consent.agreedAt},
        ${report.completePercent}, ${report.sentAt})`,
    sql`insert into ticket (ticket_number, report_id, status, updated_at) values (${ticket}, ${reportId}, 'new', ${report.sentAt})`,
    sql`insert into ticket_history (ticket_number, from_status, to_status, actor, at)
      values (${ticket}, null, 'new', 'system', ${report.sentAt})`,
  ];
}

// The reply a retried send answers with, made from the ticket number the batch gave.
export const storeTicketReply = (
  draftId: string,
  turnKey: string,
  requestHash: string,
  ticketNumber: Query,
  sentAt: Date,
): Query =>
  sql`insert into turn_reply (draft_id, turn_key, request_hash, status, body, created_at)
    values (${draftId}, ${turnKey}, ${requestHash}, 201,
      json_object('ticketNumber', ${ticketNumber}, 'sentAt', json_object('utc', ${sentAt}, 'zone', 'WIB')), ${sentAt})`;
