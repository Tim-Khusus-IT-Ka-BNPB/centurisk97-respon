// The events of BNPB's daily report as upstream's Alun-alun gathers them (public/data/alun/
// kabar.json, kabar-alun K1 to K6): per regency and hazard, the report's own status and figures,
// and the news found for it. Its keys are the source's own, read as they are. No imports, so the Node import scripts share it.

// Upstream's kinds as our hazard types; a kind not here is left out.
const KINDS: Readonly<Record<string, string>> = {
  banjir: "flood",
  longsor: "landslide",
  cuaca: "extremeWeather",
  gempa: "earthquake",
  kebakaran_gedung: "buildingFire",
  kekeringan: "drought",
  karhutla: "forestFire",
  erupsi: "volcanicEruption",
  abrasi: "tidalWaveAbrasion",
  tsunami: "tsunami",
};

const STATUSES = ["berjalan", "belum", "selesai"] as const;

type News = { readonly judul: string; readonly media: string; readonly tgl: string; readonly url: string };
type Figures = { readonly kk: number | null; readonly mengungsi: number | null; readonly rumah_dampak: number | null };

type OfficialEventEntry = {
  readonly id: string;
  readonly jenis: string;
  readonly kab: string;
  readonly prov: string;
  readonly titik: { readonly lat: number; readonly lon: number } | null;
  readonly status: (typeof STATUSES)[number];
  readonly mulai: string;
  readonly lap_terakhir: string;
  readonly selesai_lama: boolean;
  readonly angka: Figures;
  readonly berita: readonly News[];
};

export type OfficialEventFile = {
  readonly dibuat: string;
  readonly hari: string;
  readonly kejadian: readonly OfficialEventEntry[];
};

const isDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isCount = (value: unknown) => value === null || (Number.isInteger(value) && (value as number) >= 0);

const isEvent = (value: unknown) => {
  const one = value as Partial<OfficialEventEntry> | null;
  const point = one?.titik as { lat?: unknown; lon?: unknown } | null | undefined;
  const figures = (one?.angka ?? {}) as Partial<Figures>;
  return (
    typeof one?.id === "string" &&
    typeof one.jenis === "string" &&
    typeof one.kab === "string" &&
    typeof one.prov === "string" &&
    (point === null || (typeof point?.lat === "number" && typeof point.lon === "number")) &&
    STATUSES.includes(one.status as OfficialEventEntry["status"]) &&
    isDate(one.mulai) &&
    isDate(one.lap_terakhir) &&
    typeof one.selesai_lama === "boolean" &&
    isCount(figures.kk) &&
    isCount(figures.mengungsi) &&
    isCount(figures.rumah_dampak) &&
    Array.isArray(one.berita) &&
    one.berita.every(
      (news) =>
        typeof news?.judul === "string" &&
        typeof news.media === "string" &&
        isDate(news.tgl) &&
        typeof news.url === "string",
    )
  );
};

export function checkOfficialEventFile(json: unknown): OfficialEventFile | null {
  const file = json as Partial<OfficialEventFile> | null;
  if (typeof file?.dibuat !== "string" || Number.isNaN(Date.parse(file.dibuat)) || !isDate(file.hari)) return null;
  return Array.isArray(file.kejadian) && file.kejadian.every(isEvent) ? (file as OfficialEventFile) : null;
}

export type OfficialEvent = {
  readonly id: string;
  readonly hazardType: string;
  readonly regencyName: string;
  readonly provinceCode: string;
  readonly point: { readonly lat: number; readonly lon: number } | null;
  readonly status: OfficialEventEntry["status"];
  readonly startedOn: string;
  readonly lastReportOn: string;
  readonly families: number | null;
  readonly displaced: number | null;
  readonly houses: number | null;
  // At most three, each to its own page on the web.
  readonly news: readonly {
    readonly title: string;
    readonly outlet: string;
    readonly date: string;
    readonly url: string;
  }[];
  readonly moreNews: number;
};

export const NEWS_SHOWN = 3;
const ORDER = { berjalan: 0, belum: 1, selesai: 2 } as const;

// The events still worth showing, ongoing first, then by their latest report. Long finished ones,
// and kinds we do not report, are left out.
export function officialEvents(file: OfficialEventFile): readonly OfficialEvent[] {
  return file.kejadian
    .filter((one) => !one.selesai_lama && KINDS[one.jenis] !== undefined)
    .map((one) => {
      const news = one.berita.filter((item) => /^https:\/\//.test(item.url));
      return {
        id: one.id,
        hazardType: KINDS[one.jenis] as string,
        regencyName: one.kab,
        provinceCode: one.prov,
        point: one.titik,
        status: one.status,
        startedOn: one.mulai,
        lastReportOn: one.lap_terakhir,
        families: one.angka.kk,
        displaced: one.angka.mengungsi,
        houses: one.angka.rumah_dampak,
        news: news
          .slice(0, NEWS_SHOWN)
          .map((item) => ({ title: item.judul, outlet: item.media, date: item.tgl, url: item.url })),
        moreNews: Math.max(0, news.length - NEWS_SHOWN),
      };
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.lastReportOn.localeCompare(a.lastReportOn));
}

// A regency named as BNPB's report names it, "Kab. Bogor", "Kabupaten Bogor" or "Bogor", compared
// as one; "Kota Administrasi X" is "Kota X".
export const regencyKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^kota administrasi /, "kota ")
    .replace(/^(kabupaten|kab\.) /, "");
