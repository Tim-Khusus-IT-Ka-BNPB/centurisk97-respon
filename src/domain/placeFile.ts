// The upstream village file: data date, source, regency names by code, and one row per village
// of code, name and district name. Province names come from our own reference list.
export type PlaceFile = {
  readonly dataDate: string;
  readonly source: string;
  readonly regencies: Readonly<Record<string, string>>;
  readonly rows: readonly (readonly [string, string, string])[];
};

// A file from upstream with fewer places than this is a broken export, not the country.
export const UPSTREAM_FLOOR = { villages: 80_000, regencies: 500 } as const;

export type PlaceFileProblem =
  | { readonly kind: "shape" }
  | { readonly kind: "dataDate" }
  | { readonly kind: "row"; readonly index: number }
  | { readonly kind: "duplicate"; readonly code: string }
  | { readonly kind: "noRegency"; readonly code: string }
  | { readonly kind: "noProvince"; readonly code: string }
  | { readonly kind: "tooFew"; readonly villages: number; readonly regencies: number };

export type PlaceFileCheck =
  | { readonly ok: true; readonly file: PlaceFile }
  | { readonly ok: false; readonly problem: PlaceFileProblem };

const VILLAGE_CODE = /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/;

const isRecordOfText = (value: unknown): value is Record<string, string> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((entry) => typeof entry === "string" && entry !== "");

const isRow = (row: unknown): row is [string, string, string] =>
  Array.isArray(row) &&
  row.length === 3 &&
  typeof row[0] === "string" &&
  VILLAGE_CODE.test(row[0]) &&
  typeof row[1] === "string" &&
  row[1].trim() !== "" &&
  typeof row[2] === "string" &&
  row[2].trim() !== "";

// The calendar day a text names, as "YYYY-MM-DD", or null when it names none.
function isoDay(text: string): string | null {
  const ms = Date.parse(`${text}T00:00:00Z`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

// A real calendar day written as "YYYY-MM-DD": "2026-02-30" and "2026-13-01" are refused.
const validDate = (value: unknown): value is string => isoDay(`${value}`) === value;

// Checks the file against its contract before anything is written. With the floor on, a file
// that names too few villages or regencies is refused as a false empty.
export function checkPlaceFile(
  json: unknown,
  provinces: Readonly<Record<string, string>>,
  withFloor: boolean,
): PlaceFileCheck {
  const data = (json ?? {}) as Record<string, unknown>;
  if (typeof data.sumber !== "string" || !isRecordOfText(data.kab)) return { ok: false, problem: { kind: "shape" } };
  if (!Array.isArray(data.baris)) return { ok: false, problem: { kind: "shape" } };
  if (!validDate(data.dibuat)) return { ok: false, problem: { kind: "dataDate" } };
  const regencies = data.kab;
  const seen = new Set<string>();
  for (const [index, row] of (data.baris as unknown[]).entries()) {
    if (!isRow(row)) return { ok: false, problem: { kind: "row", index } };
    const code = row[0];
    if (seen.has(code)) return { ok: false, problem: { kind: "duplicate", code } };
    seen.add(code);
    if (regencies[code.slice(0, 5)] === undefined) return { ok: false, problem: { kind: "noRegency", code } };
    if (provinces[code.slice(0, 2)] === undefined) return { ok: false, problem: { kind: "noProvince", code } };
  }
  const regencyCount = new Set([...seen].map((code) => code.slice(0, 5))).size;
  if (withFloor && (seen.size < UPSTREAM_FLOOR.villages || regencyCount < UPSTREAM_FLOOR.regencies))
    return { ok: false, problem: { kind: "tooFew", villages: seen.size, regencies: regencyCount } };
  if (seen.size === 0) return { ok: false, problem: { kind: "tooFew", villages: 0, regencies: 0 } };
  return {
    ok: true,
    file: { dataDate: data.dibuat, source: data.sumber, regencies, rows: data.baris as [string, string, string][] },
  };
}

type RegencyRecord = {
  readonly code: string;
  readonly name: string;
  readonly provinceCode: string;
  readonly provinceName: string;
  readonly villageCount: number;
};

type DistrictRecord = RegencyRecord & { readonly regencyCode: string; readonly regencyName: string };

type VillageRecord = {
  readonly code: string;
  readonly name: string;
  readonly districtName: string;
  readonly regencyCode: string;
  readonly regencyName: string;
  readonly provinceCode: string;
  readonly provinceName: string;
};

export type PlaceRecords = {
  readonly regencies: readonly RegencyRecord[];
  readonly districts: readonly DistrictRecord[];
  readonly villages: readonly VillageRecord[];
};

// The rows of a snapshot: every village, and each regency and district with its village count.
export function placeRecords(file: PlaceFile, provinces: Readonly<Record<string, string>>): PlaceRecords {
  const villages = file.rows.map(([code, name, districtName]): VillageRecord => {
    const regencyCode = code.slice(0, 5);
    const regencyName = file.regencies[regencyCode] as string;
    return {
      code,
      name: name.trim(),
      districtName: districtName.trim(),
      regencyCode,
      regencyName,
      provinceCode: code.slice(0, 2),
      provinceName: provinces[code.slice(0, 2)] as string,
    };
  });
  const regencies = new Map<string, RegencyRecord>();
  const districts = new Map<string, DistrictRecord>();
  for (const village of villages) {
    const regency = regencies.get(village.regencyCode);
    regencies.set(village.regencyCode, {
      code: village.regencyCode,
      name: village.regencyName,
      provinceCode: village.provinceCode,
      provinceName: village.provinceName,
      villageCount: (regency?.villageCount ?? 0) + 1,
    });
    const districtCode = village.code.slice(0, 8);
    const district = districts.get(districtCode);
    districts.set(districtCode, {
      code: districtCode,
      name: village.districtName,
      regencyCode: village.regencyCode,
      regencyName: village.regencyName,
      provinceCode: village.provinceCode,
      provinceName: village.provinceName,
      villageCount: (district?.villageCount ?? 0) + 1,
    });
  }
  return { regencies: [...regencies.values()], districts: [...districts.values()], villages };
}
