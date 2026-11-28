import type { StaffScope } from "../../domain/deskRights";
import type { MissingPerson, MissingStatus } from "../../domain/missingPerson";
import { atomically, changedOne, type Database, empty, holds, row, rows, sql } from "../../platform/database";
import type { StaffPrincipal } from "../../ports/identity";

export type MissingRow = {
  readonly id: string;
  readonly reporter_name: string | null;
  readonly village_code: string;
  readonly regency_code: string;
  readonly place: unknown;
  readonly name: string | null;
  readonly nickname: string | null;
  readonly relation: string;
  readonly sex: string;
  readonly age: number | null;
  readonly clothes: string | null;
  readonly marks: string | null;
  readonly last_seen_date: string;
  readonly last_seen_time: string | null;
  readonly person_number: string | null;
  readonly contact_number: string | null;
  readonly wait_place: string | null;
  readonly photo_key: string | null;
  readonly status: MissingStatus;
  readonly created_at: string;
  readonly closed_at: string | null;
};

// A province account reads its regencies by the code's first two digits.
const inRegion = (scope: StaffScope) =>
  scope.level === "national"
    ? empty
    : scope.level === "regency"
      ? sql`and regency_code = ${scope.code}`
      : sql`and substr(regency_code, 1, 2) = ${scope.code}`;

export type NewMissing = {
  readonly id: string;
  readonly reporterId: string;
  readonly numberKey: string;
  readonly ownerSlot: string;
  readonly reporterName: string;
  readonly villageCode: string;
  readonly place: { villageName: string; districtName: string; regencyName: string; provinceName: string };
  readonly person: MissingPerson;
  readonly photoKey: string | null;
  readonly at: Date;
};

// The report and its first history row, together; null when this number already sent its day's share.
export async function addMissing(db: Database, report: NewMissing, perDay: number): Promise<boolean> {
  const { person } = report;
  const since = new Date(report.at.getTime() - 86_400_000);
  const done = await atomically(db, [
    holds(
      sql`(select count(*) from missing_person where number_key = ${report.numberKey} and created_at > ${since}) < ${perDay}`,
    ),
    sql`insert into missing_person (id, reporter_id, number_key, owner_slot, reporter_name, village_code, regency_code,
        place, name, nickname, relation, sex, age, clothes, marks, last_seen_date, last_seen_time, person_number,
        contact_number, wait_place, photo_key, created_at)
      values (${report.id}, ${report.reporterId}, ${report.numberKey}, ${report.ownerSlot}, ${report.reporterName},
        ${report.villageCode}, ${report.villageCode.slice(0, 5)}, ${report.place}, ${person.name}, ${person.nickname},
        ${person.relation}, ${person.sex}, ${person.age}, ${person.clothes}, ${person.marks}, ${person.lastSeen.date},
        ${person.lastSeen.time}, ${person.personNumber}, ${person.contactNumber}, ${person.waitPlace}, ${report.photoKey},
        ${report.at})`,
    sql`insert into missing_person_history (missing_id, from_status, to_status, at)
      values (${report.id}, null, 'open', ${report.at})`,
  ]);
  return done !== null;
}

export const missingList = (db: Database, scope: StaffScope, status: MissingStatus | null) =>
  rows<MissingRow>(
    db,
    sql`select * from missing_person where 1 = 1 ${inRegion(scope)} ${status === null ? empty : sql`and status = ${status}`}
      order by created_at desc limit 200`,
  );

export const missingOf = (db: Database, scope: StaffScope, id: string) =>
  row<MissingRow>(db, sql`select * from missing_person where id = ${id} ${inRegion(scope)}`);

export type MissingHistoryRow = {
  readonly to_status: MissingStatus;
  readonly note: string | null;
  readonly staff_label: string | null;
  readonly at: string;
};

// The history of each listed report, oldest first; the reports are the list's own, so a region's.
export const missingHistory = (db: Database, ids: readonly string[]) =>
  rows<MissingHistoryRow & { readonly missing_id: string }>(
    db,
    sql`select missing_id, to_status, note, staff_label, at from missing_person_history
      where missing_id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)) order by at, id`,
  );

// A move, only from the status it was read in, so two officers never overwrite each other.
export async function moveMissing(
  db: Database,
  id: string,
  from: MissingStatus,
  to: MissingStatus,
  note: string | null,
  staff: StaffPrincipal,
  at: Date,
): Promise<boolean> {
  const done = await atomically(db, [
    sql`update missing_person set status = ${to}, closed_at = ${to === "open" ? null : at}
      where id = ${id} and status = ${from} and anonymised_at is null`,
    changedOne,
    sql`insert into missing_person_history (missing_id, from_status, to_status, note, staff_id, staff_label, at)
      values (${id}, ${from}, ${to}, ${note}, ${staff.staffId}, ${staff.label}, ${at})`,
  ]);
  return done !== null;
}

// The reports of one reporter on this device or in a session, newest first.
export const ownMissing = (db: Database, reporterId: string, ownerSlot: string) =>
  rows<Pick<MissingRow, "id" | "name" | "status" | "created_at" | "place">>(
    db,
    sql`select id, name, status, created_at, place from missing_person
      where reporter_id = ${reporterId} and owner_slot = ${ownerSlot} order by created_at desc limit 20`,
  );

// Closed before this, a report keeps no name, number or photo, only its village and outcome; its
// photo file goes with it.
export async function anonymiseMissing(db: Database, before: Date, at: Date, limit: number): Promise<number> {
  const due = await rows<{ id: string; photo_key: string | null }>(
    db,
    sql`select id, photo_key from missing_person where anonymised_at is null and status <> 'open' and closed_at < ${before}
      order by closed_at limit ${limit}`,
  );
  for (const one of due) {
    await atomically(db, [
      ...(one.photo_key === null
        ? []
        : [
            sql`insert into photo_removal (store_key, queued_at) values (${one.photo_key}, ${at}) on conflict do nothing`,
          ]),
      sql`update missing_person set reporter_name = null, name = null, nickname = null, clothes = null, marks = null,
          person_number = null, contact_number = null, wait_place = null, photo_key = null, anonymised_at = ${at}
        where id = ${one.id}`,
    ]);
  }
  return due.length;
}

export const missingPhotoKey = async (db: Database, scope: StaffScope, id: string) =>
  (
    await row<{ photo_key: string | null }>(
      db,
      sql`select photo_key from missing_person where id = ${id} ${inRegion(scope)}`,
    )
  )?.photo_key ?? null;
