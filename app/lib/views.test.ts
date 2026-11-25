import { describe, expect, test } from "vitest";
import type { Card } from "../../src/contract/card";
import type { DraftBody } from "../../src/contract/draft";
import type { ErrorEnvelope } from "../../src/contract/errors";
import { hazardOf, rowView, splitAround, valueLines } from "../../src/copy/values";
import { FIELDS } from "../../src/domain/fields/catalogue";
import { HAZARD_TYPE_IDS, subtypeChoices } from "../../src/domain/hazards";
import { SAMPLE_DRAFTS } from "../../src/testing/samples";
import { text as t } from "../testing/render";
import { areaName, rowText, searchStatus } from "./place";
import { limitText, statusText } from "./status";

type Places = NonNullable<Extract<Card, { kind: "placeSearch" }>["places"]>;
type Item = Places["items"][number];
const village: Item = {
  level: "village",
  code: "11.08.01.2001",
  name: "Sukamaju",
  districtName: "Contoh",
  regencyName: "Aceh Utara",
  provinceName: "Aceh",
};
const district: Item = { ...village, level: "district", code: "11.08.01", name: "Contoh", districtName: null };
const regency: Item = { ...village, level: "regency", code: "11.08", name: "Aceh Utara", districtName: null };
const placeCard = SAMPLE_DRAFTS.placeSearch.card as Extract<Card, { kind: "placeSearch" }>;
const areaCard = SAMPLE_DRAFTS.regencyVillages.card as Extract<Card, { kind: "regencyVillages" }>;

describe("place rows", () => {
  test("a village is named over its place; a district or regency opens its villages", () => {
    expect(rowText(village, t)).toEqual({
      lead: "Desa/Kel. Sukamaju",
      place: "Kec. Contoh, Aceh Utara, Aceh",
    });
    expect(rowText({ ...village, districtName: null }, t).place).toBe("Kec. , Aceh Utara, Aceh");
    expect(rowText(district, t)).toEqual({ lead: null, place: "Kec. Contoh, Aceh Utara, Aceh: lihat desa" });
    expect(rowText(regency, t)).toEqual({ lead: null, place: "Aceh Utara, Aceh: lihat desa" });
  });

  test("a district's villages are titled with Kec., its regency and province", () => {
    expect(areaName(areaCard, t)).toBe("Aceh Utara");
    const ofDistrict = { ...areaCard, areaLevel: "district" as const, params: { areaName: "Contoh" } };
    expect(areaName(ofDistrict, t)).toBe("Kec. Contoh, Aceh Utara, Aceh");
    const empty = { ...ofDistrict, places: { ...(ofDistrict.places as Places), items: [] } };
    expect(areaName(empty, t)).toBe("Contoh");
    expect(areaName({ ...areaCard, params: {} }, t)).toBe("");
  });

  test("the status says the count, the cut, or that nothing matched", () => {
    expect(searchStatus(placeCard, t)).toBe(
      "1 dari 71 tempat cocok. Daftar terpotong. Tambahkan nama kecamatan atau kabupaten/kota supaya hasilnya lebih sedikit.",
    );
    const whole = { ...placeCard, places: { ...(placeCard.places as Places), cut: false } };
    expect(searchStatus(whole, t)).toBe("1 dari 71 tempat cocok.");
    const none = { ...placeCard, query: "zzqx", places: { ...(placeCard.places as Places), items: [], total: 0 } };
    expect(searchStatus(none, t)).toContain('"zzqx"');
    expect(searchStatus({ ...none, query: null }, t)).toContain('""');
    const noVillages = { ...areaCard, query: "x", places: { ...(areaCard.places as Places), items: [], total: 0 } };
    expect(searchStatus(noVillages, t)).toBe(
      'Tidak ada desa di Aceh Utara yang cocok dengan "x". Periksa ejaannya atau hapus sebagian kata.',
    );
    expect(searchStatus(areaCard, t)).toBe("1 dari 844 desa. Daftar terpotong. Ketik nama desa untuk menemukannya.");
    expect(searchStatus({ ...placeCard, places: null }, t)).toBe("");
    expect(searchStatus(SAMPLE_DRAFTS.summary.card, t)).toBe("");
  });
});

describe("summary rows", () => {
  const summary = SAMPLE_DRAFTS.summary.card as Extract<Card, { kind: "summary" }>;
  type Row = (typeof summary.groups)[number]["rows"][number];
  const row = (fieldId: string, value: Row["value"]): Row => ({ fieldId, state: "value", value, origin: "boxEntry" });

  test("a value reads as label, value and unit", () => {
    expect(rowView(t, row("housesHeavy", { kind: "count", count: 3 }), null)).toEqual({
      kind: "value",
      text: "Rusak berat: 3 rumah",
    });
    expect(rowView(t, row("dead", { kind: "count", count: 2000 }), "flood")).toEqual({
      kind: "value",
      text: "Meninggal: 2.000 orang",
    });
    expect(rowView(t, row("hazardType", { kind: "hazardType", hazardType: "flood" }), null).kind).toBe("value");
  });

  test("an empty state leaves a slot for its chip", () => {
    expect(rowView(t, { fieldId: "missing", state: "confirmedUnknown", value: null, origin: null }, null)).toEqual({
      kind: "chip",
      state: "confirmedUnknown",
      before: "Hilang: ",
    });
    expect(rowView(t, { fieldId: "dead", state: "value", value: null, origin: null }, null)).toMatchObject({
      state: "notYetKnown",
    });
  });

  test("each kind of value is told in the reporter's words", () => {
    expect(valueLines(t, "shelters", { kind: "text", text: "balai desa" })).toEqual(["balai desa"]);
    expect(
      valueLines(t, "chronology", {
        kind: "chronology",
        hazardType: "flood",
        steps: [],
        note: null,
        text: "Air naik.",
      }),
    ).toEqual(["Air naik."]);
    expect(
      valueLines(t, "roadPassable", { kind: "options", optionIds: ["cutOff", "unknown"], otherText: "jembatan" }),
    ).toEqual(["Putus, tidak bisa dilewati, Tidak tahu, dan jembatan"]);
    expect(valueLines(t, "roadPassable", { kind: "options", optionIds: ["cutOff"], otherText: null })).toEqual([
      "Putus, tidak bisa dilewati",
    ]);
    expect(
      valueLines(t, "hazardSubtype", { kind: "hazardSubtype", hazardType: "flood", subtype: "riverOverflow" }),
    ).toEqual(["Banjir luapan sungai"]);
    expect(valueLines(t, "hazardSubtype", { kind: "hazardSubtype", hazardType: "flood", subtype: "unknown" })).toEqual([
      "Tidak tahu",
    ]);
    const time = (value: Extract<Row["value"], { kind: "eventTime" }>["time"]) =>
      valueLines(t, "eventTime", { kind: "eventTime", time: value })[0];
    expect(time({ kind: "olderThan30Days" })).toBe("Sudah lebih dari 30 hari");
    expect(time({ kind: "dateOnly", localDate: "2026-11-23", zone: "WIT" })).toBe(
      "23 November 2026, jam tidak diketahui",
    );
    expect(time({ kind: "dateTime", localDate: "2026-11-23", localTime: "10:00", zone: "WIT" })).toBe(
      "23 November 2026, pukul 10.00 WIT",
    );
    expect(
      valueLines(t, "place", {
        kind: "place",
        villageName: "Sukamaju",
        districtName: "Contoh",
        regencyName: "Aceh Utara",
        provinceName: "Aceh",
        precision: "villageLevel",
        point: null,
      }),
    ).toEqual(["Desa/Kel. Sukamaju", "Kec. Contoh, Aceh Utara, Aceh"]);
    const gps = { lat: 5.1, lon: 97.1, accuracyM: 12.4 };
    const read = {
      kind: "place" as const,
      villageName: "Sukamaju",
      districtName: "Contoh",
      regencyName: "Aceh Utara",
      provinceName: "Aceh",
    };
    expect(valueLines(t, "place", { ...read, precision: "gpsPoint", point: gps })[2]).toBe(
      "Titik GPS, ketelitian ±12 m",
    );
    expect(valueLines(t, "place", { ...read, precision: "estimate", point: { ...gps, accuracyM: 1500 } })[2]).toBe(
      "Perkiraan, GPS kurang teliti, ketelitian ±1.500 m",
    );
    expect(valueLines(t, "place", { ...read, precision: "villageLevel", point: gps })).toHaveLength(2);
    expect(valueLines(t, "neighbourhood", { kind: "neighbourhood", rt: "004", rw: null })).toEqual(["RT 004"]);
    expect(valueLines(t, "neighbourhood", { kind: "neighbourhood", rt: null, rw: "002" })).toEqual(["RW 002"]);
    expect(valueLines(t, "neighbourhood", { kind: "neighbourhood", rt: "004", rw: "002" })).toEqual([
      "RT 004 dan RW 002",
    ]);
  });

  test("only the unknown answer falls back to Tidak tahu; a picked answer with no label fails loudly", () => {
    expect(() => valueLines(t, "roadPassable", { kind: "options", optionIds: ["nope"], otherText: null })).toThrow(
      "option.roadPassable.nope.label",
    );
    expect(() =>
      valueLines(t, "hazardSubtype", { kind: "hazardSubtype", hazardType: "flood", subtype: "nope" }),
    ).toThrow("hazardSubtype.flood.nope.label");
  });

  test("an unknown answer with no wording of its own reads as Tidak tahu", () => {
    expect(valueLines(t, "notAField", { kind: "options", optionIds: ["unknown"], otherText: null })).toEqual([
      "Tidak tahu",
    ]);
  });

  test("every option and subtype the field spec offers has a label", () => {
    for (const field of FIELDS)
      if ("options" in field)
        for (const option of field.options)
          expect(valueLines(t, field.id, { kind: "options", optionIds: [option.id], otherText: null })[0]).not.toBe("");
    for (const hazardType of HAZARD_TYPE_IDS)
      for (const subtype of subtypeChoices(hazardType))
        expect(valueLines(t, "hazardSubtype", { kind: "hazardSubtype", hazardType, subtype })[0]).not.toBe("");
  });

  test("the hazard picked selects label variants", () => {
    expect(hazardOf(summary.groups)).toBe("flood");
    expect(hazardOf([])).toBeNull();
    expect(
      hazardOf([{ groupId: "victims", rows: [{ fieldId: "dead", state: "none", value: null, origin: null }] }]),
    ).toBeNull();
  });

  test("a key can be split around one placeholder", () => {
    expect(splitAround(t, "card.sent.ticket", {}, "ticketNumber")).toEqual({ before: "Nomor tiket: ", after: "" });
  });
});

describe("the one polite status", () => {
  const now = Date.parse("2026-11-23T03:00:00.000Z");
  const limit: ErrorEnvelope = {
    error: { code: "limit.message.minute", copyKey: "limit.message.minute", params: { limit: 20 } },
    fields: [],
    retryAt: { utc: "2026-11-23T03:01:00.000Z", zone: "WIB" },
    draft: null,
  };

  test("a limit names its retry time with the zone", () => {
    expect(limitText(t, limit, now)).toContain("Lanjutkan mulai pukul 10.01 WIB.");
    expect(limitText(t, { ...limit, retryAt: { utc: "2026-11-24T03:01:00.000Z", zone: "WIB" } }, now)).toContain(
      "Lanjutkan mulai pukul 10.01 WIB, 24 November.",
    );
    expect(limitText(t, { ...limit, retryAt: null }, now)).toContain("Lanjutkan mulai .");
    expect(statusText(t, SAMPLE_DRAFTS.numberForm, limit, now)).toContain("20 pesan per menit");
  });

  test("a refusal answering a typed message is announced, then search counts, else nothing", () => {
    const refused: DraftBody = {
      ...SAMPLE_DRAFTS.numberForm,
      transcript: [
        ...SAMPLE_DRAFTS.numberForm.transcript,
        {
          speaker: "assistant",
          cardKind: null,
          copyKey: "refusal.offTopic",
          params: {},
          at: SAMPLE_DRAFTS.numberForm.keptUntil,
        },
        {
          speaker: "assistant",
          cardKind: "numberForm",
          copyKey: "group.victims.label",
          params: {},
          at: SAMPLE_DRAFTS.numberForm.keptUntil,
        },
      ],
    };
    expect(statusText(t, refused, null, now)).toBe(t("refusal.offTopic"));
    expect(statusText(t, SAMPLE_DRAFTS.placeSearch, null, now)).toContain("tempat cocok");
    expect(statusText(t, SAMPLE_DRAFTS.numberForm, null, now)).toBe("");
    expect(statusText(t, { ...SAMPLE_DRAFTS.numberForm, transcript: [] }, null, now)).toBe("");
  });
});
