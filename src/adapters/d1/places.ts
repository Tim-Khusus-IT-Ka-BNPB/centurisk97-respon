import type { PlaceValue } from "../../domain/fieldState";
import type { AreaLevel } from "../../domain/placeSearch";
import { type Database, empty, type Query, row, rows, sql } from "../../platform/database";

type VillageRow = {
  snapshot_id: number;
  code: string;
  name: string;
  district_name: string;
  regency_name: string;
  province_name: string;
};

// A village of the active snapshot, as a place picked by search, or null when it is not there.
export async function activeVillage(db: Database, code: string): Promise<PlaceValue | null> {
  const found = await row<VillageRow>(
    db,
    sql`select v.snapshot_id, v.code, v.name, v.district_name, v.regency_name, v.province_name
      from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active = 1
      where v.code = ${code}`,
  );
  if (!found) return null;
  return {
    villageCode: found.code,
    precision: "villageLevel",
    snapshotId: found.snapshot_id,
    villageName: found.name,
    districtName: found.district_name,
    regencyName: found.regency_name,
    provinceName: found.province_name,
  };
}

export type ActiveSnapshot = { readonly id: number; readonly dataDate: string };

export async function activeSnapshot(db: Database): Promise<ActiveSnapshot | null> {
  const found = await row<{ id: number; data_date: string }>(
    db,
    sql`select id, data_date from place_snapshot where active = 1`,
  );
  return found ? { id: found.id, dataDate: found.data_date } : null;
}

export type PlaceHit = {
  readonly level: "regency" | "district" | "village";
  readonly code: string;
  readonly name: string;
  readonly districtName: string | null;
  readonly regencyName: string;
  readonly provinceName: string;
};

export type PlaceHits = { readonly items: readonly PlaceHit[]; readonly total: number };

type HitRow = {
  level: PlaceHit["level"];
  code: string;
  name: string;
  district_name: string | null;
  regency_name: string;
  province_name: string;
  total: number;
};

const hits = (rows: readonly HitRow[]): PlaceHits => ({
  items: rows.map((row) => ({
    level: row.level,
    code: row.code,
    name: row.name,
    districtName: row.district_name,
    regencyName: row.regency_name,
    provinceName: row.province_name,
  })),
  total: rows[0]?.total ?? 0,
});

// Every typed word must appear in the place's words. instr, not like: D1 refuses a like
// pattern longer than 50 characters, and a typed word may be 60.
function everyWord(words: readonly string[]): Query {
  return words.reduce((fragment, word) => sql`${fragment} and instr(search_text, ${word}) > 0`, empty);
}

const startsWith = (text: Query, word: string) => sql`substr(${text}, 1, ${word.length}) = ${word}`;

// A regency's words without the kind of regency in front, so "kota" alone does not rank first.
const REGENCY_NAME = sql`case
  when search_text like 'kota administrasi %' then substr(search_text, 19)
  when search_text like 'kota %' then substr(search_text, 6)
  when search_text like 'kabupaten %' then substr(search_text, 11)
  else search_text end`;

// Regencies first, then districts, then villages; within each, names that start with the first
// word come first. The total counts every match, not only the ones listed.
export async function searchCountry(
  db: Database,
  snapshotId: number,
  words: readonly string[],
  limit: number,
): Promise<PlaceHits> {
  const first = words[0] as string;
  const match = everyWord(words);
  const found = await rows<HitRow>(
    db,
    sql`
    with found as (
      select 'regency' as level, code, name, null as district_name, name as regency_name, province_name,
        case when ${startsWith(REGENCY_NAME, first)} then 0 else 1 end as rank
      from place_regency where snapshot_id = ${snapshotId} ${match}
      union all
      select 'district', code, name, null, regency_name, province_name,
        case when ${startsWith(sql`search_text`, first)} then 2 else 3 end
      from place_district where snapshot_id = ${snapshotId} ${match}
      union all
      select 'village', code, name, district_name, regency_name, province_name,
        case when ${startsWith(sql`search_text`, first)} then 4 else 5 end
      from place_village where snapshot_id = ${snapshotId} ${match}
    )
    select level, code, name, district_name, regency_name, province_name, count(*) over () as total
    from found order by rank, name, code limit ${limit}`,
  );
  return hits(found);
}

export type Area = {
  readonly level: AreaLevel;
  readonly code: string;
  readonly name: string;
  readonly regencyName: string;
  readonly provinceName: string;
};

export async function areaOf(db: Database, snapshotId: number, level: AreaLevel, code: string): Promise<Area | null> {
  const found = await row<{ name: string; regency_name: string; province_name: string }>(
    db,
    level === "regency"
      ? sql`select name, name as regency_name, province_name from place_regency
          where snapshot_id = ${snapshotId} and code = ${code}`
      : sql`select name, regency_name, province_name from place_district
          where snapshot_id = ${snapshotId} and code = ${code}`,
  );
  return found
    ? { level, code, name: found.name, regencyName: found.regency_name, provinceName: found.province_name }
    : null;
}

// The villages of a regency or district, filtered by the typed words, names that start with the
// first word first. With no words every village of the area is listed by name.
export async function searchArea(
  db: Database,
  snapshotId: number,
  area: Pick<Area, "level" | "code">,
  words: readonly string[],
  limit: number,
): Promise<PlaceHits> {
  const first = words[0] ?? "";
  const regencyCode = area.code.slice(0, 5);
  const inDistrict = area.level === "district" ? sql`and ${startsWith(sql`code`, `${area.code}.`)}` : empty;
  const found = await rows<HitRow>(
    db,
    sql`select 'village' as level, code, name, district_name, regency_name, province_name, count(*) over () as total
    from place_village
    where snapshot_id = ${snapshotId} and regency_code = ${regencyCode} ${inDistrict} ${everyWord(words)}
    order by case when ${startsWith(sql`search_text`, first)} then 0 else 1 end, name, code
    limit ${limit}`,
  );
  return hits(found);
}
