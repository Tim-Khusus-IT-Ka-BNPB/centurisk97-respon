import { describe, expect, test } from "vitest";
import type { DocumentBlock } from "../domain/document";
import type { FieldStates } from "../domain/fieldState";
import { PHOTO_BASE } from "../testing/photoBase";
import { type DocumentSource, documentOf, pictureOf } from "./documentContent";

const AT = { utc: "2026-11-25T02:15:00.000Z", zone: "WIB" } as const;
const PLACE = {
  state: "value",
  origin: "tappedOption",
  value: {
    villageCode: "11.08.01.2001",
    precision: "gpsPoint",
    point: { lat: 5.1, lon: 97.2, accuracyM: 12.4 },
    snapshotId: 1,
    villageName: "Contoh",
    districtName: "Baktiya",
    regencyName: "Aceh Utara",
    provinceName: "Aceh",
  },
} as const;
const count = (value: number) => ({ state: "value", value, origin: "boxEntry" }) as const;
const NONE = { state: "none", origin: "boxEntry" } as const;

const source = (states: FieldStates, more: Partial<DocumentSource> = {}): DocumentSource => ({
  ticketNumber: "LA-251126-01",
  version: 1,
  sentAt: AT,
  versionAt: AT,
  states: { place: PLACE, ...states },
  change: null,
  reporterRole: "citizen",
  officerRegency: null,
  numberUnverified: false,
  emergency: null,
  photos: [],
  photosLeft: 0,
  forStaff: false,
  ...more,
});

const blocks = <K extends DocumentBlock["kind"]>(from: DocumentSource, kind: K) =>
  documentOf(from).blocks.filter((block): block is Extract<DocumentBlock, { kind: K }> => block.kind === kind);
const points = (from: DocumentSource) => blocks(from, "numbered")[0]?.items ?? [];
const impact = (from: DocumentSource) => points(from).find((item) => item.label === "Dampak")?.lines ?? [];
const rows = (from: DocumentSource) => blocks(from, "table").flatMap((table) => table.rows);
const texts = (from: DocumentSource) =>
  rows(from).map((row) => (typeof row === "string" ? row : row.map((c) => c.text).join("|")));

describe("what a document says", () => {
  test("a place read from GPS with its RT and RW, its point and how well it is known", () => {
    const from = source({
      neighbourhood: { state: "value", origin: "boxEntry", value: { rt: "3", rw: "5" } },
    });
    expect(points(from)[0]?.lines).toEqual(["Desa/Kel. Contoh, RT 3 dan RW 5, Kec. Baktiya, Aceh Utara, Prov. Aceh"]);
    expect(texts(from)).toContain(
      "Lokasi|Desa/Kel. Contoh, Kec. Baktiya, Aceh Utara, Aceh, Titik GPS, ketelitian ±12 m. Titik 5.10000, 97.20000|Dipilih pelapor",
    );
    expect(texts(from)).toContain("Nomor pelapor|Sudah diverifikasi");
  });

  test("the headline names the hazard, its kind when known, or says it is not known", () => {
    const headline = (states: FieldStates) => blocks(source(states), "headline")[0]?.text;
    const flood = { state: "value", origin: "tappedOption", value: "flood" } as const;
    const subtype = (value: string) => ({ state: "value", origin: "tappedOption", value }) as const;
    expect(headline({ hazardType: flood })).toBe("Bencana Banjir di Aceh Utara, Prov. Aceh");
    expect(headline({ hazardType: flood, hazardSubtype: subtype("unknown") })).toBe(
      "Bencana Banjir di Aceh Utara, Prov. Aceh",
    );
    expect(headline({ hazardType: flood, hazardSubtype: subtype("flashFlood") })).toBe(
      "Bencana Banjir (banjir bandang) di Aceh Utara, Prov. Aceh",
    );
    const unknown = "Kejadian yang jenisnya belum diketahui di Aceh Utara, Prov. Aceh";
    expect(headline({})).toBe(unknown);
    expect(headline({ hazardType: { ...flood, value: "other" } })).toBe(unknown);
  });

  test("counts, none and not known are told apart, with their own words", () => {
    expect(
      impact(
        source({
          hazardType: { state: "value", origin: "tappedOption", value: "flood" },
          dead: count(1200),
          missing: NONE,
          displacedPeople: count(30),
          displacedFamilies: NONE,
          shelters: { state: "value", origin: "boxEntry", value: "Masjid Contoh" },
          housesHeavy: NONE,
          housesModerate: NONE,
          housesLight: NONE,
          housesFlooded: NONE,
          schools: count(2),
          healthFacilities: { state: "notYetKnown" },
          disruptedServices: {
            state: "value",
            origin: "tappedOption",
            value: { optionIds: ["powerOut"], otherText: null },
          },
          waterDepth: { state: "confirmedUnknown", origin: "tappedOption" },
        }),
      ),
    ).toEqual([
      "Korban jiwa: 1.200 orang meninggal; hilang tidak ada; luka-luka belum diketahui.",
      "Pengungsi: 30 orang; jumlah keluarga tidak ada. Titik pengungsian: Masjid Contoh.",
      "Kerusakan rumah: tidak ada.",
      "Fasilitas umum dan jalan: 2 sekolah; fasilitas kesehatan, tempat ibadah, dan jalan atau jembatan belum diketahui.",
      expect.stringMatching(/^Layanan terganggu: \S/),
      "Tinggi air: tidak tahu.",
    ]);
  });

  test("a drought asks nothing of houses or facilities, so neither is told", () => {
    const from = source({ hazardType: { state: "value", origin: "tappedOption", value: "drought" } });
    expect(impact(from).some((line) => /rumah|Fasilitas/.test(line))).toBe(false);
    expect(blocks(from, "figures")[0]?.figures.map((figure) => figure.label)).toEqual([
      "Meninggal",
      "Hilang",
      "Luka-luka",
      "Mengungsi",
    ]);
  });

  test("figures: a number with its unit, an explicit none and nothing known", () => {
    expect(blocks(source({ dead: count(2), missing: NONE }), "figures")[0]?.figures.slice(0, 3)).toEqual([
      { label: "Meninggal", value: "2", unit: "orang", known: true },
      { label: "Hilang", value: "tidak ada", unit: null, known: true },
      { label: "Luka-luka", value: "belum didata", unit: null, known: false },
    ]);
    expect(blocks(source({ housesHeavy: count(4) }), "figures")[0]?.figures.at(-1)).toMatchObject({
      label: "Rumah rusak berat",
      unit: "rumah",
    });
  });

  test("news from the reporter says so, with its photos; no changed value is said in words", () => {
    const from = source(
      {},
      { version: 2, change: { before: { place: PLACE }, madeBy: "reporter", note: null, newPhotos: 2 } },
    );
    expect(blocks(from, "band").map((band) => band.text)).toContain("Versi ini memuat kabar tambahan dari pelapor");
    const said = blocks(from, "paragraph").map((paragraph) => paragraph.text);
    expect(said).toContain("Ditambahkan pelapor, 25 November 2026, pukul 09.15 WIB.");
    expect(said).toContain("Tidak ada isian yang berubah.");
    expect(said).toContain("2 foto baru.");
    expect(texts(from)).toContain("Waktu versi ini|25 November 2026, pukul 09.15 WIB");
  });

  test("none and not known with no count are told apart in one line", () => {
    const said = impact(source({ dead: NONE, missing: { state: "notYetKnown" } }));
    expect(said).toContain("Korban jiwa: meninggal tidak ada; hilang dan luka-luka belum diketahui.");
  });

  test("an officer's note under a value is for staff; the reporter reads that it was corrected", () => {
    const states: FieldStates = { dead: { state: "value", value: 2, origin: "officer", quote: "Dicek" } };
    expect(texts(source(states))).toContain("Meninggal|2 orang|Koreksi lapangan");
    expect(texts(source(states, { forStaff: true }))).toContain('Meninggal|2 orang|Koreksi lapangan: "Dicek"');
    expect(texts(source({ missing: { state: "notYetKnown" } }))).toContain("Hilang|belum didata|");
  });

  test("photos far from the place say so; photos that could not be put in are counted, not called none", () => {
    const picture = pictureOf(PHOTO_BASE) as NonNullable<ReturnType<typeof pictureOf>>;
    const photo = { picture, badge: "photoData", far: true, takenAt: AT } as const;
    const from = source({}, { photos: [photo], photosLeft: 1 });
    expect(blocks(from, "photos")[0]?.photos[0]?.caption).toBe(
      "Foto 1. Lokasi dari data foto, jauh dari lokasi kejadian, 25 November 2026, pukul 09.15 WIB",
    );
    const said = blocks(source({}, { photosLeft: 1 }), "paragraph").map((paragraph) => paragraph.text);
    expect(said).toContain("1 foto lain tidak dimuat di dokumen ini.");
    expect(said).not.toContain("Pelapor tidak mengirim foto.");
    expect(pictureOf(Uint8Array.from([1, 2]))).toBeNull();
  });
});
