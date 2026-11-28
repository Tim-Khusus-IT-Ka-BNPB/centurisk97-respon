import { describe, expect, test } from "vitest";
import { validateExtraction } from "./extraction";
import { maskText } from "./masking";
import { templateParse } from "./templateParse";

const read = (text: string) => {
  const message = maskText(text, { name: null, number: null });
  return validateExtraction(templateParse(message), message, null);
};
const counts = (text: string) =>
  Object.fromEntries(
    Object.entries(read(text).fields).map(([id, value]) => [id, value?.kind === "count" ? value.count : null]),
  );

describe("reading a message with no model", () => {
  test("a count before or after its words, in digits or in words, each with its quote", () => {
    expect(read("rusak berat 5").fields).toEqual({
      housesHeavy: { kind: "count", count: 5, quote: "rusak berat 5", translation: null },
    });
    expect(counts("tiga rumah rusak berat dan 2 orang meninggal")).toEqual({ housesHeavy: 3, dead: 2 });
    expect(counts("meninggal sebanyak 4, hilang jadi 1.200")).toEqual({ dead: 4, missing: 1200 });
    expect(counts("dua belas keluarga mengungsi, empat puluh orang mengungsi")).toEqual({
      displacedFamilies: 12,
      displacedPeople: 40,
    });
    expect(counts("seratus lima puluh warga terdampak")).toEqual({ affectedPeople: 150 });
  });

  test("every count has its words", () => {
    expect(
      counts(
        "3 keluarga terdampak, 4 warga terdampak, 5 dirawat inap, 6 rumah rusak sedang, 7 rumah rusak ringan, 8 rumah terendam, 9 puskesmas, 10 masjid, 11 sekolah, 12 jembatan",
      ),
    ).toEqual({
      affectedFamilies: 3,
      affectedPeople: 4,
      injuredInpatient: 5,
      housesModerate: 6,
      housesLight: 7,
      housesFlooded: 8,
      healthFacilities: 9,
      worshipPlaces: 10,
      schools: 11,
      roads: 12,
    });
    expect(read("gunung erupsi").hazardGuesses.map((guess) => guess.hazardType)).toEqual(["volcanicEruption"]);
  });

  test("tidak ada before the words is a none; words with no number are nothing", () => {
    expect(read("tidak ada korban jiwa").fields).toEqual({
      dead: { kind: "count", count: 0, quote: "tidak ada korban jiwa", translation: null },
    });
    expect(counts("atap rumah rusak berat")).toEqual({});
    expect(counts("beberapa rumah rusak berat")).toEqual({});
    expect(counts("belas rumah rusak berat")).toEqual({});
  });

  test("each span is read once, so families are not also people", () => {
    expect(counts("kk mengungsi 3")).toEqual({ displacedFamilies: 3 });
    expect(counts("3 orang luka-luka, 2 dirawat inap")).toEqual({ injured: 3, injuredInpatient: 2 });
  });

  test("hazard types guessed from their words, never anything else", () => {
    expect(read("banjir dan longsor di desa").hazardGuesses).toEqual([
      { hazardType: "flood", subtype: null },
      { hazardType: "landslide", subtype: null },
    ]);
    expect(read("kebakaran hutan dan rumah terbakar").hazardGuesses.map((guess) => guess.hazardType)).toEqual([
      "forestFire",
      "buildingFire",
    ]);
    const all = "abrasi puting beliung kemarau gempa tsunami erupsi rob";
    expect(read(all).hazardGuesses.map((guess) => guess.hazardType)).toEqual([
      "flood",
      "tidalWaveAbrasion",
      "extremeWeather",
      "drought",
    ]);
    expect(read("terjadi sesuatu").hazardGuesses).toEqual([]);
    expect(templateParse(maskText("x", { name: null, number: null }))).toMatchObject({
      lifeAtRisk: false,
      reply: null,
      topic: "disaster",
    });
  });

  test("its raw proposal, before the checks", () => {
    const raw = (text: string) => templateParse(maskText(text, { name: null, number: null }));
    expect((raw("gempa lalu tsunami") as { hazardGuesses: unknown }).hazardGuesses).toEqual([
      { hazardType: "earthquake", confidence: 1 },
      { hazardType: "tsunami", confidence: 1 },
    ]);
    expect(raw("hujan saja")).toEqual({
      fields: [],
      hazardGuesses: [],
      lifeAtRisk: false,
      reply: null,
      topic: "disaster",
    });
    expect(raw("belas rumah rusak berat, tidak ada yang hilang")).toEqual({
      fields: [
        { field: "housesHeavy", value: "undefined", quote: "belas rumah rusak berat" },
        { field: "missing", value: "0", quote: "tidak ada yang hilang" },
      ],
      hazardGuesses: [],
      lifeAtRisk: false,
      reply: null,
      topic: "disaster",
    });
  });
});
