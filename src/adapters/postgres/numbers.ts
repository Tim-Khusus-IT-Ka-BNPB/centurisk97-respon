import { atomically, changedOne, type Database, row, rows, sql } from "../../platform/database";
import { sha256Hex } from "../../platform/keys";

// The two reference files BNPB keeps on the desk.
export type NumbersFile = "bpbdContacts" | "facilityNumbers";

export type NumbersRecord = { readonly body: unknown; readonly checksum: string };

// The file in use and its checksum, the version an edit starts from.
export const numbersRecord = (db: Database, name: NumbersFile): Promise<NumbersRecord | null> =>
  row<NumbersRecord>(db, sql`select body, checksum from reference_file where name = ${name}`);

export type NumbersSave = {
  readonly name: NumbersFile;
  // The whole file after the edit, and the date it names.
  readonly body: unknown;
  readonly dataDate: string;
  // The checksum the edit started from; null when there was no file.
  readonly startedFrom: string | null;
  readonly entry: string;
  readonly change: "added" | "changed" | "removed";
  readonly before: unknown;
  readonly after: unknown;
  readonly staff: { readonly id: string; readonly label: string };
  readonly at: Date;
};

// Writes the file and its change together, only over the version the edit started from. Answers the
// new checksum, or null when another edit or an import came first.
export async function saveNumbers(db: Database, save: NumbersSave): Promise<string | null> {
  const text = JSON.stringify(save.body);
  const checksum = await sha256Hex(text);
  const done = await atomically(db, [
    sql`insert into reference_file (name, data_date, source, body, checksum, imported_at)
      values (${save.name}, ${save.dataDate}, 'desk', ${text}, ${checksum}, ${save.at})
      on conflict (name) do update set data_date = excluded.data_date, source = excluded.source,
        body = excluded.body, checksum = excluded.checksum, imported_at = excluded.imported_at
      where reference_file.checksum = ${save.startedFrom}`,
    changedOne,
    sql`insert into reference_change (name, entry, change, before, after, staff_id, staff_label, at)
      values (${save.name}, ${save.entry}, ${save.change}, ${save.before}, ${save.after}, ${save.staff.id},
        ${save.staff.label}, ${save.at})`,
  ]);
  return done === null ? null : checksum;
}

export type NumbersChange = {
  readonly id: number;
  readonly entry: string | null;
  readonly change: "added" | "changed" | "removed" | "imported";
  readonly before: unknown;
  readonly after: unknown;
  readonly staff_label: string | null;
  readonly at: string;
};

// The file's latest changes, newest first.
export const numbersChanges = (db: Database, name: NumbersFile, limit: number): Promise<NumbersChange[]> =>
  rows<NumbersChange>(
    db,
    sql`select id, entry, change, before, after, staff_label, at from reference_change
      where name = ${name} order by id desc limit ${limit}`,
  );

export type NumbersArea = {
  readonly code: string;
  readonly name: string;
  readonly provinceName: string;
  readonly level: "province" | "regency";
};

// Every province and regency of the places in use, as the contact file keys them ("11", "1101"),
// each province before its regencies.
export const numbersAreas = (db: Database): Promise<NumbersArea[]> =>
  rows<NumbersArea>(
    db,
    sql`with regency as (
        select r.* from place_regency r join place_snapshot s on s.id = r.snapshot_id and s.active
      )
      select distinct province_code as code, province_name as name, province_name as "provinceName",
        'province' as level
      from regency
      union all
      select replace(code, '.', ''), name, province_name, 'regency' from regency
      order by code`,
  );
