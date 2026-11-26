import type { StaffScope } from "../../domain/deskRights";
import type { TicketStatus } from "../../domain/stages";
import { type Database, row, rows, run, sql } from "../../platform/database";
import type { StaffPrincipal } from "../../ports/identity";
import { regionCondition } from "./deskShared";

// What the public feed reads (K59, D84 to D86). Never a name, a number, a ticket, a text the
// reporter wrote, or the reporter's own point: the feed is built from the rows below alone.

// Only reports being handled or closed are public (HF5).
const SHOWN_SQL = sql`t.status in ('in_handling', 'closed')`;

const LATEST = sql`(select max(m.version) from report_version m where m.report_id = r.id)`;

export type ShownRow = {
  readonly report_id: string;
  readonly ticket_number: string;
  readonly hazard_type: string;
  readonly village_code: string;
  readonly status: TicketStatus;
  readonly sent_at: string;
  readonly fields: string;
  readonly centre_lat: number | null;
  readonly centre_lon: number | null;
};

// Handled reports, newest first, each with its village's centre: the only point the feed shows.
export const shownReports = (
  db: Database,
  filter: { readonly hazardType: string | null; readonly provinceCode: string | null },
) =>
  rows<ShownRow>(
    db,
    sql`select r.id as report_id, r.ticket_number, r.hazard_type, r.village_code, t.status, r.sent_at, v.fields,
        s.centre_lat, s.centre_lon
      from report r
      join ticket t on t.report_id = r.id
      join report_version v on v.report_id = r.id and v.version = ${LATEST}
      left join place_village_shape s on s.code = r.village_code
        and s.snapshot_id = (select id from place_snapshot where active = 1)
      where ${SHOWN_SQL}
        and (${filter.hazardType} is null or r.hazard_type = ${filter.hazardType})
        and (${filter.provinceCode} is null or r.province_code = ${filter.provinceCode})
      order by r.sent_at desc limit 300`,
  );

export type ClusterRow = {
  readonly ticket_number: string;
  readonly hazard_type: string;
  readonly village_code: string;
  readonly regency_code: string;
  readonly number_key: string;
  readonly status: TicketStatus;
  readonly sent_at: string;
  readonly fields: string;
  readonly placed_photo: number;
};

// Every report sent since a time, of a region or of all, to find the clusters among them.
export const recentReports = (db: Database, since: Date, scope: StaffScope = { level: "national" }) =>
  rows<ClusterRow>(
    db,
    sql`select r.ticket_number, r.hazard_type, r.village_code, r.regency_code, r.number_key, t.status, r.sent_at,
        v.fields,
        exists (select 1 from draft_photo p where p.draft_id = r.draft_id and p.badge in ('deviceGps', 'photoData'))
          as placed_photo
      from report r
      join ticket t on t.report_id = r.id
      join report_version v on v.report_id = r.id and v.version = ${LATEST}
      where r.sent_at > ${since}${regionCondition(scope)}
      order by r.sent_at desc limit 3000`,
  );

// A photo's newest mark decides.
const NEWEST_MARK = sql`(select u.public from proof_publication u where u.proof_id = p.id order by u.id desc limit 1)`;

// The photos of the work an officer marked public, of reports that are shown.
export const publicProofs = (db: Database) =>
  rows<{ id: string; ticket_number: string }>(
    db,
    sql`select p.id, p.ticket_number from handling_proof p join ticket t on t.ticket_number = p.ticket_number
      where ${SHOWN_SQL} and ${NEWEST_MARK} = 1
      order by p.received_at desc limit 500`,
  );

export async function publicProofKey(db: Database, proofId: string): Promise<string | null> {
  const found = await row<{ store_key: string }>(
    db,
    sql`select p.store_key from handling_proof p join ticket t on t.ticket_number = p.ticket_number
      where p.id = ${proofId} and ${SHOWN_SQL} and ${NEWEST_MARK} = 1`,
  );
  return found?.store_key ?? null;
}

// Marks one photo of a report in the officer's region; false when there is no such photo.
export const markProof = async (
  db: Database,
  staff: StaffPrincipal,
  ticketNumber: string,
  proofId: string,
  shown: boolean,
  at: Date,
): Promise<boolean> =>
  (await run(
    db,
    sql`insert into proof_publication (proof_id, public, staff_id, staff_label, at)
      select p.id, ${shown ? 1 : 0}, ${staff.staffId}, ${staff.label}, ${at}
      from handling_proof p join report r on r.ticket_number = p.ticket_number
      where p.id = ${proofId} and p.ticket_number = ${ticketNumber}${regionCondition(staff.scope)}`,
  )) === 1;
