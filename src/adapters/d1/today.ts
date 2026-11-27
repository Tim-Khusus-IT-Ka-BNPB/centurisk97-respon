import type { TodayReport } from "../../domain/todayPage";
import { type Database, rows, run, sql } from "../../platform/database";
import type { StaffPrincipal } from "../../ports/identity";

// What the today page reads of a report: the five conditions' facts, and what its card may show.
export type TodayRow = TodayReport & {
  readonly reportId: string;
  readonly ticketNumber: string;
  readonly hazardType: string;
  readonly sentAt: string;
  // The latest version's values, as kept.
  readonly fields: string;
  readonly numberKey: string;
  // Its village's centre in the active place data, the only point the page shows.
  readonly centre: { readonly lat: number; readonly lon: number } | null;
};

type Base = {
  report_id: string;
  ticket_number: string;
  village_code: string;
  hazard_type: string;
  sent_at: string;
  status: string;
  fields: string;
  number_key: string;
  centre_lat: number | null;
  centre_lon: number | null;
};

const BASE = sql`select r.id as report_id, r.ticket_number, r.village_code, r.hazard_type, r.sent_at, r.number_key,
    t.status, v.fields, s.centre_lat, s.centre_lon
  from report r
  join ticket t on t.report_id = r.id
  join report_version v on v.report_id = r.id
    and v.version = (select max(version) from report_version where report_id = r.id)
  left join place_village_shape s on s.code = r.village_code
    and s.snapshot_id = (select id from place_snapshot where active = 1)`;

// Each report's checks, versions and pulls, read once for all of them.
async function completed(db: Database, found: readonly Base[]): Promise<TodayRow[]> {
  if (found.length === 0) return [];
  const tickets = JSON.stringify(found.map((one) => one.ticket_number));
  const [checks, versions, pulls] = await Promise.all([
    rows<{
      id: number;
      ticket_number: string;
      result: string;
      at: string;
      checker_role: string | null;
      checker_level: string | null;
      checker_code: string | null;
    }>(
      db,
      sql`select id, ticket_number, result, at, checker_role, checker_level, checker_code from field_check
        where ticket_number in (select value from json_each(${tickets}))`,
    ),
    rows<{ ticket_number: string; created_at: string }>(
      db,
      sql`select r.ticket_number, v.created_at from report_version v join report r on r.id = v.report_id
        where r.ticket_number in (select value from json_each(${tickets}))`,
    ),
    rows<{ id: number; ticket_number: string; pulled: number }>(
      db,
      sql`select id, ticket_number, pulled from today_pull where ticket_number in (select value from json_each(${tickets}))`,
    ),
  ]);
  return found.map((one) => ({
    reportId: one.report_id,
    ticketNumber: one.ticket_number,
    villageCode: one.village_code,
    hazardType: one.hazard_type,
    sentAt: one.sent_at,
    status: one.status,
    fields: one.fields,
    numberKey: one.number_key,
    centre: one.centre_lat === null ? null : { lat: one.centre_lat, lon: one.centre_lon as number },
    checks: checks
      .filter((check) => check.ticket_number === one.ticket_number)
      .map((check) => ({
        id: check.id,
        result: check.result,
        atMs: Date.parse(check.at),
        role: check.checker_role,
        level: check.checker_level,
        code: check.checker_code,
      })),
    versionsAtMs: versions
      .filter((version) => version.ticket_number === one.ticket_number)
      .map((version) => Date.parse(version.created_at)),
    pulls: pulls
      .filter((pull) => pull.ticket_number === one.ticket_number)
      .map((pull) => ({ id: pull.id, pulled: pull.pulled === 1 })),
  }));
}

// The reports with a Valid check since then: the only ones that may show.
export async function todayCandidates(db: Database, since: Date): Promise<TodayRow[]> {
  return completed(
    db,
    await rows<Base>(
      db,
      sql`${BASE} where exists (select 1 from field_check c where c.ticket_number = r.ticket_number
        and c.result = 'valid' and c.at >= ${since})`,
    ),
  );
}

// One report's facts, for the desk's list of the five conditions; the desk has read the report already.
export async function todayOf(db: Database, ticketNumber: string): Promise<TodayRow> {
  return (
    await completed(db, await rows<Base>(db, sql`${BASE} where r.ticket_number = ${ticketNumber}`))
  )[0] as TodayRow;
}

// An event pulled off the page, or put back: a row each time.
export const pullToday = (db: Database, staff: StaffPrincipal, ticketNumber: string, pulled: boolean, at: Date) =>
  run(
    db,
    sql`insert into today_pull (ticket_number, pulled, staff_id, staff_label, at)
      values (${ticketNumber}, ${pulled}, ${staff.staffId}, ${staff.label}, ${at})`,
  );
