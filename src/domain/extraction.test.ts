import { describe, expect, test } from "vitest";
import { validateExtraction } from "./extraction";
import { type MaskedText, maskText } from "./masking";

const said = (text: string): MaskedText => maskText(text, { name: null, number: null });
const fieldsOnly = (fields: unknown[], message: string, hazard: Parameters<typeof validateExtraction>[2] = "flood") =>
  validateExtraction({ fields }, said(message), hazard).fields;

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
      housesHeavy: { kind: "count", count: 3, quote: "tiga rumah rusak berat" },
      dead: { kind: "count", count: 0, quote: "tidak ada korban jiwa" },
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
    expect(result).toEqual({ fields: {}, hazardGuesses: [], lifeAtRisk: false, reply: null, topic: "disaster" });
  });

  test("a text value made of the reporter's own words is kept", () => {
    expect(
      fieldsOnly(
        [{ field: "shelters", value: "Masjid Al Ikhlas, balai desa", quote: "di masjid al ikhlas" }],
        "warga mengungsi di Masjid Al Ikhlas dan balai desa",
      ),
    ).toEqual({ shelters: { kind: "text", text: "masjid al ikhlas, balai desa", quote: "di masjid al ikhlas" } });
  });

  test("short connecting words of a text value need not be said", () => {
    expect(
      fieldsOnly([{ field: "roadNames", value: "jalan di km 5", quote: "jalan" }], "jalan km 5 putus", "flood"),
    ).toEqual({ roadNames: { kind: "text", text: "jalan di km 5", quote: "jalan" } });
    expect(fieldsOnly([{ field: "roadNames", value: "jalan raya", quote: "jalan" }], "jalan putus")).toEqual({});
    expect(fieldsOnly([{ field: "roadNames", value: "jalan rel", quote: "jalan" }], "jalan putus")).toEqual({});
  });

  test("a text value over its length or empty is dropped", () => {
    const long = "a".repeat(301);
    expect(fieldsOnly([{ field: "shelters", value: long, quote: "aaa" }], long)).toEqual({});
    const fits = "a".repeat(300);
    expect(fieldsOnly([{ field: "shelters", value: fits, quote: "aaa" }], fits)).toEqual({
      shelters: { kind: "text", text: fits, quote: "aaa" },
    });
    expect(fieldsOnly([{ field: "shelters", value: "masjid", quote: "" }], "masjid")).toEqual({});
    expect(fieldsOnly([{ field: "shelters", value: "", quote: "ab" }], "ab")).toEqual({});
    expect(fieldsOnly([{ field: "shelters", value: 7, quote: "ab" }], "ab")).toEqual({});
  });

  test("a count must be a whole number within the field maximum", () => {
    const message = "korban 100000 orang, 100001 orang, 2,5 orang, -1";
    expect(fieldsOnly([{ field: "dead", value: "100000", quote: "korban 100000 orang" }], message)).toEqual({
      dead: { kind: "count", count: 100_000, quote: "korban 100000 orang" },
    });
    expect(fieldsOnly([{ field: "dead", value: "100001", quote: "100001 orang" }], message)).toEqual({});
    expect(fieldsOnly([{ field: "dead", value: "2,5", quote: "2,5 orang" }], message)).toEqual({});
    expect(fieldsOnly([{ field: "dead", value: "-1", quote: "-1" }], message)).toEqual({});
    expect(fieldsOnly([{ field: "dead", value: 3, quote: "korban" }], message)).toEqual({});
    expect(fieldsOnly([{ field: "dead", value: "2.0", quote: "2.0 orang" }], "2.0 orang")).toEqual({});
    expect(fieldsOnly([{ field: "dead", value: "5", quote: "tidak ada korban" }], "tidak ada korban")).toEqual({});
  });

  test("a zero is kept only with a negation word in its quote", () => {
    const zero = (quote: string, message = quote) => fieldsOnly([{ field: "missing", value: "0", quote }], message);
    for (const quote of [
      "tidak ada yang hilang",
      "hilang nihil",
      "tanpa korban hilang",
      "hilang nol",
      "belum ada hilang",
    ]) {
      expect(zero(quote)).toEqual({ missing: { kind: "count", count: 0, quote } });
    }
    expect(zero("semua selamat")).toEqual({});
    expect(zero("tidakada")).toEqual({});
    expect(zero("xtidak ada")).toEqual({});
  });

  test("the quote must be in the message, ignoring case and emphasis", () => {
    expect(fieldsOnly([{ field: "dead", value: "2", quote: "*DUA* orang" }], "ada dua orang meninggal")).toEqual({
      dead: { kind: "count", count: 2, quote: "dua orang" },
    });
    expect(fieldsOnly([{ field: "dead", value: "2", quote: "dua orang" }], "ada tiga orang")).toEqual({});
    expect(fieldsOnly([{ field: "dead", value: "2", quote: "" }], "dua")).toEqual({});
    expect(fieldsOnly([{ field: "dead", value: "2" }], "dua")).toEqual({});
  });

  test("only count and text fields that apply to the hazard type", () => {
    expect(fieldsOnly([{ field: "housesHeavy", value: "2", quote: "dua rumah" }], "dua rumah", "drought")).toEqual({});
    expect(fieldsOnly([{ field: "housesFlooded", value: "2", quote: "dua rumah" }], "dua rumah", "drought")).toEqual(
      {},
    );
    expect(fieldsOnly([{ field: "housesFlooded", value: "2", quote: "dua rumah" }], "dua rumah", null)).toEqual({
      housesFlooded: { kind: "count", count: 2, quote: "dua rumah" },
    });
    expect(fieldsOnly([{ field: "hazardType", value: "flood", quote: "banjir" }], "banjir")).toEqual({});
    expect(fieldsOnly([{ field: "waterDepth", value: "50", quote: "50" }], "50")).toEqual({});
    expect(fieldsOnly([{ field: "eventTime", value: "hari ini", quote: "hari ini" }], "hari ini")).toEqual({});
  });

  test("broken answers give an empty extraction", () => {
    const empty = { fields: {}, hazardGuesses: [], lifeAtRisk: false, reply: null, topic: "disaster" };
    expect(validateExtraction(null, said("x"), "flood")).toEqual(empty);
    expect(validateExtraction("teks", said("x"), "flood")).toEqual(empty);
    expect(validateExtraction({ fields: "x", hazardGuesses: {} }, said("x"), "flood")).toEqual(empty);
    expect(validateExtraction({ fields: [null, undefined, 3] }, said("x"), "flood")).toEqual(empty);
    expect(validateExtraction({ fields: { field: "dead" }, hazardGuesses: [null] }, said("x"), "flood")).toEqual(empty);
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
