import { PILOT_MAX, type PilotNumber } from "../../domain/pilot";
import { atomically, changedOne, type Database, holds, type Query, row, rows, sql } from "../../platform/database";
import type { StaffPrincipal } from "../../ports/identity";
import { staffRow } from "./deskShared";

export async function isAllowed(db: Database, numberKey: string): Promise<boolean> {
  return (await row(db, sql`select 1 as one from pilot_number where number_key = ${numberKey}`)) !== null;
}

export type PilotRecord = PilotNumber & {
  readonly numberKey: string;
  readonly addedBy: string;
  readonly addedAt: Date;
  // Reports its chat sent.
  readonly reports: number;
  readonly lastReportAt: Date | null;
};

// The list, the newest first, each with what its chat has sent.
export async function pilotNumbers(db: Database): Promise<PilotRecord[]> {
  const found = await rows<{
    number_key: string;
    number: string;
    officer_regency: string | null;
    added_by: string;
    added_at: string;
    reports: number;
    last_report_at: string | null;
  }>(
    db,
    sql`select p.number_key, p.number, p.officer_regency, p.added_by, p.added_at, count(r.id) as reports,
        max(r.sent_at) as last_report_at
      from pilot_number p left join report r on r.number_key = p.number_key and r.door = 'chat'
      group by p.number_key order by p.added_at desc, p.number`,
  );
  return found.map((one) => ({
    numberKey: one.number_key,
    number: one.number,
    officerRegency: one.officer_regency,
    addedBy: one.added_by,
    addedAt: new Date(one.added_at),
    reports: one.reports,
    lastReportAt: one.last_report_at === null ? null : new Date(one.last_report_at),
  }));
}

// An officer at the desk changes the list, and the act is logged as any other.
const changed = (numberKey: string, change: "allowed" | "removed", staff: StaffPrincipal, at: Date): Query[] => [
  sql`insert into pilot_change (number_key, change, by_kind, by_id, at)
    values (${numberKey}, ${change}, 'staff', ${staff.staffId}, ${at})`,
  staffRow(staff, change === "allowed" ? "pilotAllow" : "pilotRemove", at),
];

// Allows a number, or words anew what it is allowed as. False when the list is full.
export async function allowNumber(
  db: Database,
  numberKey: string,
  { number, officerRegency }: PilotNumber,
  staff: StaffPrincipal,
  at: Date,
): Promise<boolean> {
  const done = await atomically(db, [
    holds(sql`(select count(*) from pilot_number where number_key <> ${numberKey}) < ${PILOT_MAX}`),
    sql`insert into pilot_number (number_key, number, officer_regency, added_by, added_at)
      values (${numberKey}, ${number}, ${officerRegency}, ${staff.label}, ${at})
      on conflict (number_key) do update set officer_regency = excluded.officer_regency, added_by = excluded.added_by,
        added_at = excluded.added_at`,
    ...changed(numberKey, "allowed", staff, at),
  ]);
  return done !== null;
}

// Takes a number off the list; false when it was not on it.
export async function removeNumber(db: Database, numberKey: string, staff: StaffPrincipal, at: Date): Promise<boolean> {
  const done = await atomically(db, [
    sql`delete from pilot_number where number_key = ${numberKey}`,
    changedOne,
    ...changed(numberKey, "removed", staff, at),
  ]);
  return done !== null;
}
