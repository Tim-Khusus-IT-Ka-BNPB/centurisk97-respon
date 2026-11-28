import { type Database, type Query, rows, sql } from "../../platform/database";
import type { StaffPrincipal } from "../../ports/identity";

export type ReportEvent = { readonly code: string; readonly tickets: readonly string[] };

// The event a report belongs to, with its reports in the order they joined; null with none.
export async function eventOf(db: Database, ticketNumber: string): Promise<ReportEvent | null> {
  const found = await rows<{ ticket_number: string; code: string }>(
    db,
    sql`select ticket_number, code from report_event
      where code = (select code from report_event where ticket_number = ${ticketNumber}) order by at, ticket_number`,
  );
  return found[0] ? { code: found[0].code, tickets: found.map((one) => one.ticket_number) } : null;
}

// BNPB takes a report out of its event (D106): its code and its links go, and the event goes when
// fewer than two reports are left in it. The ticket's history tells of it.
export const releaseFromEvent = (
  ticketNumber: string,
  event: ReportEvent,
  status: string,
  staff: StaffPrincipal,
  at: Date,
): Query[] => [
  sql`delete from report_event where ticket_number = ${ticketNumber}`,
  sql`delete from report_event where code = ${event.code}
    and (select count(*) from report_event where code = ${event.code}) < 2`,
  sql`delete from report_link where ticket_number = ${ticketNumber} or same_as = ${ticketNumber}`,
  sql`insert into ticket_history (ticket_number, from_status, to_status, actor, actor_id, actor_label, at, event, detail)
    values (${ticketNumber}, ${status}, ${status}, 'staff', ${staff.staffId}, ${staff.label}, ${at}, 'released',
      ${{ code: event.code }})`,
];
