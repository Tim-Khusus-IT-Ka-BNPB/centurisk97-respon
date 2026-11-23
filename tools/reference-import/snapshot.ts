import type { PlaceRecords } from "../../src/domain/placeFile.ts";
import { placeSearchText } from "../../src/domain/placeText.ts";
import { atomically, type Database, type Query, row, sql } from "../../src/platform/database.ts";

const KEEP_SNAPSHOTS = 2;
// D1 binds at most 100 values to one statement, and takes a bounded batch.
const MAX_VALUES = 100;
const BATCH_STATEMENTS = 200;

export type SnapshotMeta = { readonly source: string; readonly dataDate: string; readonly checksum: string };
export type SnapshotWrite = { readonly kind: "written"; readonly snapshotId: number } | { readonly kind: "unchanged" };

type Table = "place_regency" | "place_district" | "place_village";
type Rows = Record<string, string | number>[];

const COLUMNS: Readonly<Record<Table, readonly string[]>> = {
  place_regency: ["snapshot_id", "code", "name", "province_code", "province_name", "village_count", "search_text"],
  place_district: [
    "snapshot_id",
    "code",
    "name",
    "regency_code",
    "regency_name",
    "province_code",
    "province_name",
    "village_count",
    "search_text",
  ],
  place_village: [
    "snapshot_id",
    "code",
    "name",
    "district_name",
    "regency_code",
    "regency_name",
    "province_code",
    "province_name",
    "search_text",
  ],
};

// Multi-row inserts, each under the value limit.
function inserts(table: Table, rows: Rows): Query[] {
  const columns = COLUMNS[table];
  const perStatement = Math.floor(MAX_VALUES / columns.length);
  const statements: Query[] = [];
  for (let start = 0; start < rows.length; start += perStatement) {
    const chunk = rows.slice(start, start + perStatement);
    const tuples = chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
    statements.push({
      text: `insert into ${table} (${columns.join(", ")}) values ${tuples}`,
      values: chunk.flatMap((one) => columns.map((column) => one[column])),
    });
  }
  return statements;
}

// The words each level is found by: a regency by its name and province, a district by its name
// and regency, a village by its name, district and regency (upstream's word match).
function rowsOf(records: PlaceRecords, snapshotId: number): Readonly<Record<Table, Rows>> {
  return {
    place_regency: records.regencies.map((r) => ({
      snapshot_id: snapshotId,
      code: r.code,
      name: r.name,
      province_code: r.provinceCode,
      province_name: r.provinceName,
      village_count: r.villageCount,
      search_text: placeSearchText(r.name, r.provinceName),
    })),
    place_district: records.districts.map((d) => ({
      snapshot_id: snapshotId,
      code: d.code,
      name: d.name,
      regency_code: d.regencyCode,
      regency_name: d.regencyName,
      province_code: d.provinceCode,
      province_name: d.provinceName,
      village_count: d.villageCount,
      search_text: placeSearchText(d.name, d.regencyName),
    })),
    place_village: records.villages.map((v) => ({
      snapshot_id: snapshotId,
      code: v.code,
      name: v.name,
      district_name: v.districtName,
      regency_code: v.regencyCode,
      regency_name: v.regencyName,
      province_code: v.provinceCode,
      province_name: v.provinceName,
      search_text: placeSearchText(v.name, v.districtName, v.regencyName),
    })),
  };
}

// Writes a new snapshot unseen, then makes it the one searched in one batch, so a search sees
// the old snapshot or the new one, never half of one. A write that stops halfway leaves an
// inactive snapshot, removed by later imports. The same file twice writes nothing.
export async function writeSnapshot(db: Database, records: PlaceRecords, meta: SnapshotMeta): Promise<SnapshotWrite> {
  const current = await row(db, sql`select id from place_snapshot where active = 1 and checksum = ${meta.checksum}`);
  if (current) return { kind: "unchanged" };
  const created = (await row<{ id: number }>(
    db,
    sql`insert into place_snapshot (source, data_date, imported_at, village_count, regency_count, checksum)
      values (${meta.source}, ${meta.dataDate}, ${new Date()}, ${records.villages.length}, ${records.regencies.length},
        ${meta.checksum})
      returning id`,
  )) as { id: number };
  const rows = rowsOf(records, created.id);
  const statements = (["place_regency", "place_district", "place_village"] as const).flatMap((table) =>
    inserts(table, rows[table]),
  );
  for (let start = 0; start < statements.length; start += BATCH_STATEMENTS)
    await atomically(db, statements.slice(start, start + BATCH_STATEMENTS));
  await atomically(db, [
    sql`update place_snapshot set active = 0 where active = 1 and id <> ${created.id}`,
    sql`update place_snapshot set active = 1 where id = ${created.id}`,
    // The two newest are kept, so the one before can be made active again by hand.
    sql`delete from place_snapshot where id not in (
      select id from place_snapshot order by imported_at desc, id desc limit ${KEEP_SNAPSHOTS})`,
  ]);
  return { kind: "written", snapshotId: created.id };
}
