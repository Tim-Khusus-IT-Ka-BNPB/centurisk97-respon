import { atomically, changedOne, type Database, previousChangedOne, row, rows, sql } from "../../platform/database";
import type { StaffPrincipal } from "../../ports/identity";
import { actionRow } from "./deskShared";

const ACTIVE = sql`join place_snapshot s on s.id = a.snapshot_id and s.active`;

// An area's name from the places in use: a regency's ("11.08"), or a province's ("11"); null for neither.
export async function areaName(db: Database, area: string): Promise<string | null> {
  const found = (await row<{ name: string | null }>(
    db,
    sql`select coalesce(
        (select a.name from place_regency a ${ACTIVE} where a.code = ${area}),
        (select a.province_name from place_regency a ${ACTIVE} where a.province_code = ${area} limit 1)) as name`,
  )) as { name: string | null };
  return found.name;
}

export type AreaChoice = {
  readonly area: string;
  readonly name: string;
  readonly level: "province" | "regency";
};

// Every province and regency a ticket can be given to, each province before its regencies.
export const areaChoices = (db: Database): Promise<AreaChoice[]> =>
  rows<AreaChoice>(
    db,
    sql`select distinct a.province_code as area, a.province_name as name, 'province' as level
      from place_regency a ${ACTIVE}
      union all
      select a.code, a.name, 'regency' from place_regency a ${ACTIVE}
      order by area`,
  );

// Gives the ticket at this revision to an area's BPBD, released from any hold, with a history row
// naming it; false when another officer changed the ticket first.
export async function assignTicket(
  db: Database,
  staff: StaffPrincipal,
  ticket: { readonly number: string; readonly revision: number; readonly area: string; readonly name: string },
  at: Date,
): Promise<boolean> {
  const done = await atomically(db, [
    sql`update ticket set assigned_area = ${ticket.area}, held = false, revision = revision + 1, updated_at = ${at}
      where ticket_number = ${ticket.number} and revision = ${ticket.revision}`,
    sql`insert into ticket_history (ticket_number, from_status, to_status, actor, actor_id, actor_label, at, event, detail)
      select ticket_number, status, status, 'staff', ${staff.staffId}, ${staff.label}, ${at}, 'assigned',
        ${{ area: ticket.name }}
      from ticket where ticket_number = ${ticket.number} and ${previousChangedOne}`,
    changedOne,
    actionRow(staff, ticket.number, "assign", at),
  ]);
  return done !== null;
}
