// Upstream's three-day outlook (public/prediksi/data/prediksi.json): per regency and day, each
// hazard's figures, read with upstream's own level rules (besok_inti.js), never recomputed. A file
// that fails this contract is "cannot know", never an empty or calm answer. No imports, so the Node
// import scripts share this contract.

// The threats a regency is read for, in upstream's column order; rain stands apart.
const THREATS = ["BNJ", "LSR", "API", "ASP", "GEL", "ROB", "CEX"] as const;

type Row = readonly (number | null)[];

export type ForecastFile = {
  readonly dibuat: string;
  readonly kode: Readonly<
    Record<string, { readonly label: string; readonly hari: readonly string[]; readonly kol: readonly string[] }>
  >;
  readonly kab: readonly ({
    readonly id: string;
    readonly nama: string;
    readonly pn: string;
  } & Readonly<Record<string, unknown>>)[];
  readonly waspada: readonly { readonly kab: string; readonly tenggang: number; readonly maka: string }[];
};

const isCode = (value: unknown) => {
  const code = value as { label?: unknown; hari?: unknown; kol?: unknown } | null;
  return (
    typeof code?.label === "string" &&
    Array.isArray(code.hari) &&
    code.hari.every((day) => typeof day === "string") &&
    Array.isArray(code.kol) &&
    code.kol.every((column) => typeof column === "string")
  );
};

// The file as its contract says, or null. No regency and no rain column is a broken export.
export function checkForecastFile(json: unknown): ForecastFile | null {
  const file = json as Partial<ForecastFile> | null;
  if (typeof file?.dibuat !== "string" || Number.isNaN(Date.parse(file.dibuat))) return null;
  const codes = file.kode;
  if (Object.getPrototypeOf(codes ?? 0) !== Object.prototype || !Object.values(codes as object).every(isCode))
    return null;
  if (!(codes as ForecastFile["kode"]).HJN) return null;
  if (!Array.isArray(file.kab) || file.kab.length === 0) return null;
  const regencies = file.kab.every(
    (one) => /^\d{4}$/.test(String(one?.id)) && typeof one.nama === "string" && typeof one.pn === "string",
  );
  const advice =
    Array.isArray(file.waspada) &&
    file.waspada.every(
      (one) => typeof one?.kab === "string" && typeof one.maka === "string" && Number.isInteger(one.tenggang),
    );
  return regencies && advice ? (file as ForecastFile) : null;
}

// 0 Normal, 1 Waspada, 2 Siaga, 3 Awas: upstream's levels.
export type Level = 0 | 1 | 2 | 3;
const steps =
  (a: number, b: number, c: number) =>
  (value: number): Level =>
    value < a ? 0 : value < b ? 1 : value < c ? 2 : 3;
const rainLevel = steps(20, 50, 100);
const hotspotLevel = steps(0.2, 0.5, 0.8);
const clamp = (value: number): Level => Math.max(0, Math.min(3, Math.round(value))) as Level;

// One cell's level, or null when the file holds no figure for it (never 0).
export function cellLevel(code: string, columns: readonly string[] | undefined, row: Row | undefined): Level | null {
  if (!row || !columns) return null;
  const value = (name: string) => row[columns.indexOf(name)] ?? null;
  const read = (name: string, level: (value: number) => Level) => {
    const found = value(name);
    return found === null ? null : level(found);
  };
  switch (code) {
    case "HJN":
      return read("tot", rainLevel);
    case "API":
      return read("p", hotspotLevel);
    case "ASP":
      return read("kat", clamp);
    case "ROB":
      return read("lewat", (found) => (found ? 2 : 0));
    default:
      return read("lv", clamp);
  }
}

type OutlookDay = {
  readonly date: string;
  // Total rain of the day in whole mm, and its level; null when not known.
  readonly rainMm: number | null;
  readonly rainLevel: Level | null;
  // The threats above Normal that day.
  readonly threats: readonly { readonly code: string; readonly label: string; readonly level: Level }[];
};

export type Outlook = {
  readonly regencyName: string;
  readonly provinceName: string;
  readonly madeAt: string;
  readonly days: readonly OutlookDay[];
  readonly advice: readonly { readonly date: string; readonly text: string }[];
};

// A regency's three days ("11.08"), or null when the file has none for it.
export function outlookOf(file: ForecastFile, regencyCode: string): Outlook | null {
  const regency = file.kab.find((one) => one.id === regencyCode.replace(".", ""));
  if (regency === undefined) return null;
  const rain = file.kode.HJN as ForecastFile["kode"][string];
  const rows = (code: string) => regency[code] as readonly Row[] | undefined;
  const days = rain.hari.map((date, index) => {
    const rainRow = rows("HJN")?.[index];
    const total = rainRow?.[rain.kol.indexOf("tot")] ?? null;
    return {
      date,
      rainMm: total === null || total === undefined ? null : Math.round(total),
      rainLevel: cellLevel("HJN", rain.kol, rainRow),
      threats: THREATS.flatMap((code) => {
        const level = cellLevel(code, file.kode[code]?.kol, rows(code)?.[index]);
        return level !== null && level > 0
          ? [{ code, label: (file.kode[code] as { label: string }).label, level }]
          : [];
      }),
    };
  });
  return {
    regencyName: regency.nama,
    provinceName: regency.pn,
    madeAt: file.dibuat,
    days,
    advice: file.waspada
      .filter((one) => one.kab === regency.id && rain.hari[one.tenggang - 1] !== undefined)
      .map((one) => ({ date: rain.hari[one.tenggang - 1] as string, text: one.maka })),
  };
}
