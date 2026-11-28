import type { ResponseRow } from "../../domain/response";
import { atomically, type Database, holds, rows, sql } from "../../platform/database";
import type { StaffPrincipal } from "../../ports/identity";
import { actionRow } from "./deskShared";

// The report taken in hand by one officer, with its history row and log, or nothing: false when
// another profile took it first, or it closed meanwhile.
export async function takeReport(
  db: Database,
  staff: StaffPrincipal,
  taker: {
    readonly ticketNumber: string;
    readonly profileId: string;
    readonly label: string;
  },
  at: Date,
): Promise<boolean> {
  const { ticketNumber, profileId, label } = taker;
  const done = await atomically(db, [
    holds(
      sql`exists (select 1 from ticket where ticket_number = ${ticketNumber} and status not in ('closed', 'invalid'))`,
    ),
    sql`insert into report_taker (ticket_number, profile_id, staff_id, label, at)
      values (${ticketNumber}, ${profileId}, ${staff.staffId}, ${label}, ${at})`,
    sql`insert into ticket_history (ticket_number, from_status, to_status, actor, actor_id, actor_label, at, event, detail)
      select ticket_number, status, status, 'staff', ${staff.staffId}, ${staff.label}, ${at}, 'take', ${{ taker: label }}
      from ticket where ticket_number = ${ticketNumber}`,
    actionRow(staff, ticketNumber, "take", at),
  ]);
  return done !== null;
}

// A month's reports as the response figures read them: sent, first opened by the BPBD of the
// report's own regency (an open by BNPB or by the province is not that BPBD's answer), taken in
// hand, and how easy its reporter found reporting.
export async function responseRows(
  db: Database,
  from: Date,
  to: Date,
): Promise<(ResponseRow & { regencyName: string })[]> {
  const found = await rows<{
    regency_code: string;
    regency_name: string;
    sent_at: string;
    seen_at: string | null;
    taken_at: string | null;
    rating: number | null;
  }>(
    db,
    sql`select r.regency_code, (v.fields #>> '{place,value,regencyName}') as regency_name, r.sent_at,
        (select min(a.at) from staff_action a where a.ticket_number = r.ticket_number and a.action = 'view'
          and a.staff_kind = 'regionalOfficer' and a.staff_scope_level = 'regency'
          and a.staff_scope_code = r.regency_code) as seen_at,
        (select k.at from report_taker k where k.ticket_number = r.ticket_number) as taken_at,
        (select g.rating from report_rating g where g.report_id = r.id) as rating
      from report r join report_version v on v.report_id = r.id and v.version = 1
      where r.sent_at >= ${from} and r.sent_at < ${to}`,
  );
  const ms = (text: string | null) => (text === null ? null : Date.parse(text));
  return found.map((one) => ({
    regencyCode: one.regency_code,
    regencyName: one.regency_name,
    sentMs: Date.parse(one.sent_at),
    seenMs: ms(one.seen_at),
    takenMs: ms(one.taken_at),
    rating: one.rating,
  }));
}
