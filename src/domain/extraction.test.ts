import { describe, expect, test } from "vitest";
import { validateExtraction } from "./extraction";
import { type MaskedText, maskText } from "./masking";

const said = (text: string): MaskedText => maskText(text, { name: null, number: null });
const fieldsOnly = (fields: unknown[], message: string, hazard: Parameters<typeof validateExtraction>[2] = "flood") =>
  validateExtraction({ fields }, said(message), hazard).fields;
const count = (value: number, quote: string, translation: string | null = null) => ({
  kind: "count",
  count: value,
  quote,
  translation,
});
const text = (value: string, quote: string, translation: string | null = null) => ({
  kind: "text",
  text: value,
  quote,
  translation,
});
const options = (optionIds: string[], quote: string, translation: string | null = null) => ({
  kind: "options",
  optionIds,
  quote,
  translation,
});
const EMPTY = {
  fields: {},
  hazardGuesses: [],
  lifeAtRisk: false,
  reply: null,
  topic: "disaster",
  language: null,
  indonesian: null,
};

describe("model answer kept only where the reporter's words support it", () => {
  test("ported vector: a number needs its own quote, a zero needs a negation", () => {
    const result = validateExtraction(
      {
        fields: [
          { field: "housesHeavy", value: "3", quote: "tiga rumah rusak berat" },
          { field: "dead", value: "0", quote: "tidak ada korban jiwa" },
          { field: "injured", value: "5", quote: "tiga rumah rusak berat" },
          { field: "missing", value: "2", quote: "dua orang hilang" },
          { field: "rahasia", value: "1", quote: "tiga" },
        ],
        hazardGuesses: [],
        lifeAtRisk: false,
        reply: "Ada 3 rumah, aman.",
      },
      said("tiga rumah rusak berat, tidak ada korban jiwa"),
      "flood",
    );
    expect(result.fields).toEqual({
      housesHeavy: count(3, "tiga rumah rusak berat"),
      dead: count(0, "tidak ada korban jiwa"),
    });
    expect(result.reply).toBeNull();
  });

  test("ported vector: a model sentence never enters a text value, a guess or the reply", () => {
    const secret = "Presiden ketiga adalah Habibie";
    const result = validateExtraction(
      {
        fields: [
          { field: "chronology", value: secret, quote: "presiden" },
          { field: "shelters", value: "Gedung BNPB Jakarta", quote: "presiden" },
        ],
        hazardGuesses: [{ hazardType: "rahasia", subtype: "x", confidence: 1 }],
        lifeAtRisk: false,
        reply: secret,
        topic: "disaster",
      },
      said("siapa presiden ketiga indonesia"),
      "flood",
    );
    expect(result).toEqual(EMPTY);
  });

  test("a text value made of the reporter's own words is kept, with its Indonesian when it has one", () => {
    expect(
      fieldsOnly(
        [{ field: "shelters", value: "Masjid Al Ikhlas, balai desa", quote: "di masjid al ikhlas" }],
        "warga mengungsi di Masjid Al Ikhlas dan balai desa",
      ),
    ).toEqual({ shelters: text("masjid al ikhlas, balai desa", "di masjid al ikhlas") });
    expect(
      fieldsOnly(
        [
          {
            field: "shelters",
            value: "bale desa",
            quote: "ngungsi neng bale desa",
            quoteIndonesian: " mengungsi ke balai desa ",
          },
        ],
        "warga ngungsi neng bale desa",
      ),
    ).toEqual({ shelters: text("bale desa", "ngungsi neng bale desa", "mengungsi ke balai desa") });
  });

  test("short connecting words of a text value need not be said", () => {
    expect(
      fieldsOnly([{ field: "roadNames", value: "jalan di km 5", quote: "jalan" }], "jalan km 5 putus", "flood"),
    ).toEqual({ roadNames: text("jalan di km 5", "jalan") });
    expect(fieldsOnly([{ field: "roadNames", value: "jalan raya", quote: "jalan" }], "jalan putus")).toEqual({});
    expect(fieldsOnly([{ field: "roadNames", value: "jalan rel", quote: "jalan" }], "jalan putus")).toEqual({});
  });

  test("a text value over its length or empty is dropped", () => {
    const long = "a".repeat(301);
    expect(fieldsOnly([{ field: "shelters", value: long, quote: "aaa" }], long)).toEqual({});
    const fits = "a".repeat(300);
    expect(fieldsOnly([{ field: "shelters", value: fits, quote: "aaa" }], fits)).toEqual({
      shelters: text(fits, "aaa"),
    });
    expect(fieldsOnly([{ field: "shelters", value: "masjid", quote: "" }], "masjid")).toEqual({});
    expect(fieldsOnly([{ field: "shelters", value: "", quote: "ab" }], "ab")).toEqual({});
    expect(fieldsOnly([{ field: "shelters", value: 7, quote: "ab" }], "ab")).toEqual({});
  });

  test("a count must be a whole number within the field maximum", () => {
    const message = "korban 100000 orang, 100001 orang, 2,5 orang, -1";
    expect(fieldsOnly([{ field: "dead", value: "100000", quote: "korban 100000 orang" }], message)).toEqual({
      dead: count(100_000, "korban 100000 orang"),
    });
    expect(fieldsOnly([{ field: "dead", value: "100001", quote: "100001 orang" }], message)).toEqual({});
    expect(fieldsOnly([{ field: "dead", value: "2,5", quote: "2,5 orang" }], message)).toEqual({});
    expect(fieldsOnly([{ field: "dead", value: "-1", quote: "-1" }], message)).toEqual({});
    expect(fieldsOnly([{ field: "dead", value: 3, quote: "korban" }], message)).toEqual({});
    expect(fieldsOnly([{ field: "dead", value: "2.0", quote: "2.0 orang" }], "2.0 orang")).toEqual({});
    expect(fieldsOnly([{ field: "dead", value: "5", quote: "tidak ada korban" }], "tidak ada korban")).toEqual({});
  });

  test("a zero is kept only with a negation word in its quote or its Indonesian", () => {
    const zero = (quote: string, message = quote) => fieldsOnly([{ field: "missing", value: "0", quote }], message);
    for (const quote of [
      "tidak ada yang hilang",
      "hilang nihil",
      "tanpa korban hilang",
      "hilang nol",
      "belum ada hilang",
    ]) {
      expect(zero(quote)).toEqual({ missing: count(0, quote) });
    }
    expect(zero("semua selamat")).toEqual({});
    expect(zero("tidakada")).toEqual({});
    expect(zero("xtidak ada")).toEqual({});
    const said0 = (quoteIndonesian: unknown) =>
      fieldsOnly([{ field: "injured", value: "0", quote: "ora ana sing tatu", quoteIndonesian }], "ora ana sing tatu");
    expect(said0("Tidak ada yang luka")).toEqual({
      injured: count(0, "ora ana sing tatu", "Tidak ada yang luka"),
    });
    expect(said0("semua sehat")).toEqual({});
    expect(said0(null)).toEqual({});
  });

  test("a count in another language is read through its Indonesian, unless its own words name a number", () => {
    const read = (quote: string, quoteIndonesian: string, value = "30", message = quote) =>
      fieldsOnly([{ field: "housesFlooded", value, quote, quoteIndonesian }], message);
    expect(read("omah telung puluh", "30 rumah")).toEqual({
      housesFlooded: count(30, "omah telung puluh", "30 rumah"),
    });
    expect(read("omah telung puluh", "tiga puluh rumah")).toEqual({
      housesFlooded: count(30, "omah telung puluh", "tiga puluh rumah"),
    });
    expect(read("omah telung puluh", "31 rumah")).toEqual({});
    // Digits or Indonesian number words of its own must be the number itself.
    expect(read("omah 3 telung puluh", "30 rumah")).toEqual({});
    expect(read("omah lima telung puluh", "30 rumah")).toEqual({});
    // Indonesian words read the same in both, so they need no rendering.
    expect(read("tiga puluh omah", "tiga puluh rumah")).toEqual({
      housesFlooded: count(30, "tiga puluh omah", "tiga puluh rumah"),
    });
  });

  test("an Indonesian rendering that is empty, not text, or the quote itself is not kept", () => {
    const rendered = (quoteIndonesian: unknown) =>
      fieldsOnly([{ field: "dead", value: "2", quote: "dua orang", quoteIndonesian }], "dua orang");
    for (const same of ["", "   ", 5, "DUA orang", " dua orang "])
      expect(rendered(same), String(same)).toEqual({ dead: count(2, "dua orang") });
    expect(rendered("dua jiwa")).toEqual({ dead: count(2, "dua orang", "dua jiwa") });
  });

  test("the quote must be in the message, ignoring case and emphasis", () => {
    expect(fieldsOnly([{ field: "dead", value: "2", quote: "*DUA* orang" }], "ada dua orang meninggal")).toEqual({
      dead: count(2, "dua orang"),
    });
    expect(fieldsOnly([{ field: "dead", value: "2", quote: "dua orang" }], "ada tiga orang")).toEqual({});
    expect(fieldsOnly([{ field: "dead", value: "2", quote: "" }], "dua")).toEqual({});
    expect(fieldsOnly([{ field: "dead", value: "2" }], "dua")).toEqual({});
  });

  test("only fields that apply to the hazard type, never the place, time, type or chronology", () => {
    expect(fieldsOnly([{ field: "housesHeavy", value: "2", quote: "dua rumah" }], "dua rumah", "drought")).toEqual({});
    expect(fieldsOnly([{ field: "housesFlooded", value: "2", quote: "dua rumah" }], "dua rumah", "drought")).toEqual(
      {},
    );
    expect(fieldsOnly([{ field: "housesFlooded", value: "2", quote: "dua rumah" }], "dua rumah", null)).toEqual({
      housesFlooded: count(2, "dua rumah"),
    });
    for (const field of ["hazardType", "hazardSubtype", "place", "neighbourhood", "eventTime", "chronology"])
      expect(fieldsOnly([{ field, value: "flood", quote: "banjir" }], "banjir"), field).toEqual({});
    expect(fieldsOnly([{ field: "waterDepth", value: "knee", quote: "selutut" }], "selutut", "drought")).toEqual({});
  });

  test("broken answers give an empty extraction", () => {
    expect(validateExtraction(null, said("x"), "flood")).toEqual(EMPTY);
    expect(validateExtraction("teks", said("x"), "flood")).toEqual(EMPTY);
    expect(validateExtraction({ fields: "x", hazardGuesses: {} }, said("x"), "flood")).toEqual(EMPTY);
    expect(validateExtraction({ fields: [null, undefined, 3] }, said("x"), "flood")).toEqual(EMPTY);
    expect(validateExtraction({ fields: { field: "dead" }, hazardGuesses: [null] }, said("x"), "flood")).toEqual(EMPTY);
  });
});

describe("choices read from the reporter's words", () => {
  test("a single choice is one offered option id, with its words", () => {
    expect(fieldsOnly([{ field: "waterDepth", value: "waist", quote: "sepinggang" }], "air sepinggang")).toEqual({
      waterDepth: options(["waist"], "sepinggang"),
    });
    expect(
      fieldsOnly(
        [{ field: "waterDepth", value: "chest", quote: "nganti sedhadha", quoteIndonesian: "sampai dada" }],
        "banyune nganti sedhadha",
      ),
    ).toEqual({ waterDepth: options(["chest"], "nganti sedhadha", "sampai dada") });
  });

  test("a choice not offered, two of them, not knowing, or words of its own is dropped", () => {
    const one = (value: unknown, field = "currentState") =>
      fieldsOnly([{ field, value, quote: "air naik" }], "air naik");
    expect(one("growing")).toEqual({ currentState: options(["growing"], "air naik") });
    expect(one("rising")).toEqual({});
    expect(one("growing,steady")).toEqual({});
    expect(one("unknown")).toEqual({});
    expect(one(["growing"])).toEqual({});
    expect(one("other", "urgentNeeds")).toEqual({});
  });

  test("a multiple choice keeps each offered id once, in the catalogue's order", () => {
    expect(
      fieldsOnly(
        [{ field: "urgentNeeds", value: " drinkingWater ,readyMeals,cake, drinkingWater", quote: "butuh makanan" }],
        "butuh makanan dan air",
      ),
    ).toEqual({ urgentNeeds: options(["readyMeals", "drinkingWater"], "butuh makanan") });
    expect(fieldsOnly([{ field: "urgentNeeds", value: "cake", quote: "butuh" }], "butuh")).toEqual({});
  });

  test("a none stands alone in a multiple choice", () => {
    const services = (value: string) =>
      fieldsOnly([{ field: "disruptedServices", value, quote: "semua normal" }], "semua normal");
    expect(services("allRunning")).toEqual({ disruptedServices: options(["allRunning"], "semua normal") });
    expect(services("allRunning,powerOut")).toEqual({});
    expect(services("powerOut,phoneSignalLost")).toEqual({
      disruptedServices: options(["powerOut", "phoneSignalLost"], "semua normal"),
    });
  });

  test("an option offered for one hazard only is read against the type chosen, or the likeliest", () => {
    const masks = (hazard: Parameters<typeof validateExtraction>[2], hazardGuesses: unknown[] = []) =>
      validateExtraction(
        { fields: [{ field: "urgentNeeds", value: "masks,drinkingWater", quote: "butuh masker" }], hazardGuesses },
        said("butuh masker"),
        hazard,
      ).fields;
    expect(masks("volcanicEruption")).toEqual({ urgentNeeds: options(["drinkingWater", "masks"], "butuh masker") });
    expect(masks("flood")).toEqual({ urgentNeeds: options(["drinkingWater"], "butuh masker") });
    expect(masks(null, [{ hazardType: "forestFire", confidence: 0.9 }])).toEqual({
      urgentNeeds: options(["drinkingWater", "masks"], "butuh masker"),
    });
    expect(masks(null)).toEqual({ urgentNeeds: options(["drinkingWater"], "butuh masker") });
    expect(masks("flood", [{ hazardType: "forestFire", confidence: 0.9 }])).toEqual({
      urgentNeeds: options(["drinkingWater"], "butuh masker"),
    });
  });
});

describe("hazard guesses, flags, reply and topic", () => {
  test("guesses keep offered types, best first, four at most, subtype only when it belongs", () => {
    const result = validateExtraction(
      {
        hazardGuesses: [
          { hazardType: "landslide", subtype: "flashFlood", confidence: 0.2 },
          { hazardType: "flood", subtype: "flashFlood", confidence: 0.9 },
          { hazardType: "other", subtype: "otherEvent", confidence: 1 },
          { hazardType: "earthquake", confidence: 0.5 },
          { hazardType: "tsunami", subtype: "seismic" },
          { hazardType: "drought", subtype: "agricultural", confidence: 0.1 },
          { hazardType: "forestFire", subtype: "peatLand", confidence: 0.05 },
        ],
      },
      said("x"),
      null,
    );
    expect(result.hazardGuesses).toEqual([
      { hazardType: "flood", subtype: "flashFlood" },
      { hazardType: "earthquake", subtype: null },
      { hazardType: "landslide", subtype: null },
      { hazardType: "drought", subtype: "agricultural" },
    ]);
  });

  test("a guess with no confidence ranks last", () => {
    const result = validateExtraction(
      {
        hazardGuesses: [{ hazardType: "tsunami" }, { hazardType: "flood", confidence: 0.1 }],
      },
      said("x"),
      null,
    );
    expect(result.hazardGuesses.map((guess) => guess.hazardType)).toEqual(["flood", "tsunami"]);
  });

  test("life at risk only when the flag is exactly true", () => {
    expect(validateExtraction({ lifeAtRisk: true }, said("x"), null).lifeAtRisk).toBe(true);
    expect(validateExtraction({ lifeAtRisk: "true" }, said("x"), null).lifeAtRisk).toBe(false);
  });

  test("reply and topic are ids or fall back", () => {
    for (const reply of ["sympathy", "thanks", "calm", "none"]) {
      expect(validateExtraction({ reply }, said("x"), null).reply).toBe(reply);
    }
    for (const topic of ["disaster", "offTopic", "dataRequest"]) {
      expect(validateExtraction({ topic }, said("x"), null).topic).toBe(topic);
    }
    expect(validateExtraction({ topic: "rahasia" }, said("x"), null).topic).toBe("disaster");
  });
});

describe("the message's language and its Indonesian", () => {
  const read = (language: unknown, indonesian: unknown) => {
    const { language: kept, indonesian: rendered } = validateExtraction({ language, indonesian }, said("x"), null);
    return [kept, rendered];
  };

  test("a language the page offers, other, or nothing", () => {
    for (const language of ["id", "en", "jv", "su", "mad", "ban", "pmy"]) expect(read(language, "")[0]).toBe(language);
    expect(read("other", "")[0]).toBe("other");
    expect(read("xx", "")[0]).toBeNull();
    expect(read(undefined, "")[0]).toBeNull();
  });

  test("the Indonesian is kept for a message in another language only, trimmed and bounded", () => {
    expect(read("jv", "  Banjir datang tadi malam.  ")).toEqual(["jv", "Banjir datang tadi malam."]);
    expect(read("other", "Banjir")).toEqual(["other", "Banjir"]);
    expect(read("id", "Banjir")).toEqual(["id", null]);
    expect(read(null, "Banjir")).toEqual([null, null]);
    expect(read("jv", "   ")).toEqual(["jv", null]);
    expect(read("jv", 5)).toEqual(["jv", null]);
    expect(read("jv", `${"a".repeat(4000)}b`)).toEqual(["jv", "a".repeat(4000)]);
  });
});
