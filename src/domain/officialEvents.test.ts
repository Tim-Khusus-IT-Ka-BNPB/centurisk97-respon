import { expect, test } from "vitest";
import SEED from "../../db/reference/kabar.json";
import { checkKabarFile, type KabarFile, NEWS_SHOWN, officialEvents, regencyKey } from "./officialEvents";

const news = (n: number, url = "https://example.id/berita") => ({
  judul: `Berita ${n}`,
  media: "Media",
  tgl: "2026-11-25",
  url,
});
const event = (fields: object = {}) => ({
  id: "banjir|32|Bogor|2026-11-24",
  jenis: "banjir",
  kab: "Bogor",
  prov: "32",
  kab_kode: "32|Bogor",
  titik: { lat: -6.6, lon: 106.8 },
  status: "berjalan",
  mulai: "2026-11-24",
  lap_terakhir: "2026-11-25",
  selesai_lama: false,
  angka: { kk: 12, mengungsi: null, rumah_dampak: 3 },
  berita: [news(1)],
  ...fields,
});
const file = (...kejadian: (object | null)[]) => ({ dibuat: "2026-11-26T17:04+07:00", hari: "2026-11-26", kejadian });

test("the seed passes; a file or an event out of shape does not", () => {
  expect(checkKabarFile(SEED)).not.toBeNull();
  expect(checkKabarFile(file())).not.toBeNull();
  expect(checkKabarFile(file(event({ titik: null })))).not.toBeNull();
  for (const broken of [
    null,
    { ...file(event()), dibuat: "kemarin" },
    { ...file(event()), dibuat: 5 },
    { ...file(event()), hari: "26 November" },
    { ...file(event()), kejadian: "x" },
    file(null),
    file(event({ id: 1 })),
    file(event({ jenis: null })),
    file(event({ kab: 1 })),
    file(event({ prov: 32 })),
    file(event({ titik: { lat: "1", lon: 2 } })),
    file(event({ titik: { lat: 1, lon: "2" } })),
    file(event({ status: "tanpa" })),
    file(event({ mulai: "24-11-2026" })),
    file(event({ lap_terakhir: null })),
    file(event({ selesai_lama: "tidak" })),
    file(event({ angka: { kk: -1, mengungsi: null, rumah_dampak: null } })),
    file(event({ angka: { kk: null, mengungsi: 1.5, rumah_dampak: null } })),
    file(event({ angka: { kk: null, mengungsi: null, rumah_dampak: "3" } })),
    file(event({ angka: null })),
    file(event({ berita: "x" })),
    file(event({ berita: [null] })),
    file(event({ berita: [{ ...news(1), judul: 1 }] })),
    file(event({ berita: [{ ...news(1), media: null }] })),
    file(event({ berita: [{ ...news(1), tgl: "kemarin" }] })),
    file(event({ berita: [{ ...news(1), url: 1 }] })),
  ])
    expect(checkKabarFile(broken), JSON.stringify(broken)).toBeNull();
});

test("ongoing first, then by the latest report; long finished and unknown kinds left out; three headlines at most", () => {
  const events = officialEvents(
    checkKabarFile(
      file(
        event({ id: "a", status: "selesai", lap_terakhir: "2026-11-26" }),
        event({ id: "b", status: "belum" }),
        event({
          id: "c",
          lap_terakhir: "2026-11-24",
          berita: [news(1), news(2, "http://plain.id/x"), news(3), news(4), news(5)],
        }),
        event({ id: "d", lap_terakhir: "2026-11-26", jenis: "longsor" }),
        event({ id: "e", selesai_lama: true }),
        event({ id: "f", jenis: "wabah" }),
      ),
    ) as KabarFile,
  );
  expect(events.map((one) => [one.id, one.hazardType])).toEqual([
    ["d", "landslide"],
    ["c", "flood"],
    ["b", "flood"],
    ["a", "flood"],
  ]);
  const c = events[1];
  expect(c?.news.map((one) => one.title)).toEqual(["Berita 1", "Berita 3", "Berita 4"]);
  expect(c?.moreNews).toBe(1);
  expect(NEWS_SHOWN).toBe(3);
  expect(events[0]).toMatchObject({
    regencyName: "Bogor",
    provinceCode: "32",
    point: { lat: -6.6, lon: 106.8 },
    startedOn: "2026-11-24",
    families: 12,
    displaced: null,
    houses: 3,
    news: [{ title: "Berita 1", outlet: "Media", date: "2026-11-25", url: "https://example.id/berita" }],
    moreNews: 0,
  });
  expect(officialEvents(checkKabarFile(SEED) as KabarFile).length).toBeGreaterThan(50);
});

test("regency names compare as BNPB's report and our place data write them", () => {
  expect(regencyKey("Kabupaten  Aceh Utara")).toBe("aceh utara");
  expect(regencyKey("Kab. Bogor")).toBe("bogor");
  expect(regencyKey("Kota Administrasi Jakarta Timur")).toBe("kota jakarta timur");
  expect(regencyKey("Kota Bogor")).not.toBe(regencyKey("Bogor"));
});
