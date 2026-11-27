// Volcano status as upstream keeps it from MAGMA Indonesia (PVMBG, public/banjir/data/
// gunungapi_status.json): each volcano's level, 1 Normal to 4 Awas, and its danger radius. Read as
// it is, never recomputed. A file that fails this contract is "cannot know". No imports, so the
// Node import scripts share this contract.

type VolcanoLevel = 1 | 2 | 3 | 4;

type Volcano = {
  readonly nama: string;
  readonly prov: string;
  readonly level: VolcanoLevel;
  readonly radius_km?: number | null;
  readonly laporan?: string | null;
};

export type VolcanoFile = {
  readonly sumber: string;
  readonly dibuat: string;
  readonly gunung: readonly Volcano[];
};

const isVolcano = (value: unknown) => {
  const one = value as Partial<Volcano> | null;
  return (
    typeof one?.nama === "string" &&
    typeof one.prov === "string" &&
    [1, 2, 3, 4].includes(one.level as number) &&
    (one.radius_km == null || (typeof one.radius_km === "number" && one.radius_km >= 0))
  );
};

export function checkVolcanoFile(json: unknown): VolcanoFile | null {
  const file = json as Partial<VolcanoFile> | null;
  if (typeof file?.sumber !== "string" || typeof file.dibuat !== "string" || Number.isNaN(Date.parse(file.dibuat)))
    return null;
  return Array.isArray(file.gunung) && file.gunung.length > 0 && file.gunung.every(isVolcano)
    ? (file as VolcanoFile)
    : null;
}

export type VolcanoSummary = {
  readonly source: string;
  readonly madeAt: string;
  // How many volcanoes stand at each level, 1 to 4.
  readonly counts: [number, number, number, number];
  // Those at Siaga or Awas, highest first: what a reader near one must keep away from.
  readonly raised: {
    readonly name: string;
    readonly province: string;
    readonly level: 3 | 4;
    readonly radiusKm: number | null;
    readonly report: string | null;
  }[];
};

// Only MAGMA's own pages are linked.
const MAGMA = /^https:\/\/magma\.esdm\.go\.id\//;

export function volcanoSummary(file: VolcanoFile): VolcanoSummary {
  const counts = [1, 2, 3, 4].map((level) => file.gunung.filter((one) => one.level === level).length);
  return {
    source: file.sumber,
    madeAt: file.dibuat,
    counts: counts as VolcanoSummary["counts"],
    raised: file.gunung
      .filter((one) => one.level >= 3)
      .sort((a, b) => b.level - a.level || a.nama.localeCompare(b.nama, "id"))
      .map((one) => ({
        name: one.nama,
        province: one.prov,
        level: one.level as 3 | 4,
        radiusKm: one.radius_km ?? null,
        report: one.laporan && MAGMA.test(one.laporan) ? one.laporan : null,
      })),
  };
}
