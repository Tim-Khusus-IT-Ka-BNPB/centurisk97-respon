import { describe, expect, test } from "vitest";
import type { FieldState, FieldStates } from "../fieldState";
import { type AnswerContext, applyAnswer, type CardAnswer } from "./answer";
import { type DraftContent, EMPTY_CONTENT, type Question } from "./content";

const NOW = Date.parse("2026-11-23T03:00:00.000Z");
const context: AnswerContext = {
  nowMs: NOW,
  zone: "WIB",
  reporter: { name: "Uji Satu", number: "+6280000000001" },
  phraseOf: (key) => `phrase ${key.split(".").slice(-2, -1)[0]}`,
};
const tapped = (value: string): FieldState => ({ state: "value", value, origin: "tappedOption" });
const with_ = (states: FieldStates, extra: Partial<DraftContent> = {}): DraftContent => ({
  ...EMPTY_CONTENT,
  states,
  ...extra,
});
const answer = (optionIds: string[] = [], values: Record<string, string> = {}): CardAnswer => ({ optionIds, values });
const apply = (question: Question, given: CardAnswer, content: DraftContent = EMPTY_CONTENT, asked = {}) =>
  applyAnswer(question, given, content, asked, context);
const states = (result: ReturnType<typeof apply>) => (result.kind === "applied" ? result.content.states : null);
const flood = { hazardType: tapped("flood") };

describe("number forms", () => {
  const victims = {
    kind: "numberForm",
    groupId: "victims",
    fieldIds: ["dead", "missing", "injured"],
    askedBefore: false,
  } as const;
  test("0 is a none, a count a value, empty not yet known and counted, belum tahu not known, tidak ada a none", () => {
    const result = apply(victims, answer([], { dead: "0", missing: "", injured: "12" }));
    expect(result).toEqual({
      kind: "applied",
      content: with_({
        dead: { state: "none", origin: "boxEntry" },
        missing: { state: "notYetKnown" },
        injured: { state: "value", value: 12, origin: "boxEntry" },
      }),
      asked: { missing: 1 },
    });
    for (const typed of ["belum tahu juga", "saya belum tahu", "nihil sekali", "2 tidak ada"])
      expect(apply(victims, answer([], { dead: typed })).kind, typed).toBe("invalid");
    expect(states(apply(victims, answer([], { dead: "Belum tahu", missing: "tidak ada" })))).toMatchObject({
      dead: { state: "confirmedUnknown", origin: "boxEntry" },
      missing: { state: "none", origin: "boxEntry" },
    });
  });

  test("a second empty answer settles it as not known", () => {
    const result = apply(victims, answer([], { dead: "", missing: "", injured: "" }), EMPTY_CONTENT, { dead: 1 });
    expect(result.kind === "applied" && result.content.states.dead).toEqual({
      state: "confirmedUnknown",
      origin: "boxEntry",
    });
    expect(result.kind === "applied" && result.asked).toEqual({ dead: 2, missing: 1, injured: 1 });
  });

  test("the form buttons settle empty boxes only, and keep a box already filled from words", () => {
    const told = with_({
      dead: { state: "none", origin: "quote", quote: "tidak ada korban jiwa" },
      missing: { state: "value", value: 2, origin: "quote", quote: "dua hilang" },
    });
    const cleared = apply(victims, answer([], {}), told);
    expect(states(cleared)?.dead).toEqual({ state: "notYetKnown" });
    const none = apply(victims, answer(["allNone"], { injured: "3" }), told);
    expect(states(none)).toEqual({
      dead: { state: "none", origin: "quote", quote: "tidak ada korban jiwa" },
      missing: { state: "value", value: 2, origin: "quote", quote: "dua hilang" },
      injured: { state: "value", value: 3, origin: "boxEntry" },
    });
    const unknown = apply(victims, answer(["allUnknown"]), with_({ dead: { state: "notYetKnown" } }));
    expect(states(unknown)).toEqual({
      dead: { state: "confirmedUnknown", origin: "tappedOption" },
      missing: { state: "confirmedUnknown", origin: "tappedOption" },
      injured: { state: "confirmedUnknown", origin: "tappedOption" },
    });
    expect(
      states(apply(victims, answer(["allNone"]), with_({ dead: { state: "confirmedUnknown", origin: "boxEntry" } })))
        ?.dead,
    ).toEqual({ state: "none", origin: "tappedOption" });
  });

  test("ada, a fraction and a count over the maximum are refused naming each box; buttons other than the two are stale", () => {
    expect(apply(victims, answer([], { dead: "ada", missing: "1,5", injured: "1000001" }))).toEqual({
      kind: "invalid",
      errors: [
        { fieldId: "dead", rule: "countNeeded", params: { label: "field.dead.label", max: 100_000 } },
        { fieldId: "missing", rule: "wholeNumber", params: { label: "field.missing.label", max: 100_000 } },
        { fieldId: "injured", rule: "tooLarge", params: { label: "field.injured.label", max: 1_000_000 } },
      ],
    });
    expect(apply(victims, answer(["allNone", "allUnknown"]))).toEqual({ kind: "stale" });
    expect(apply(victims, answer(["send"]))).toEqual({ kind: "stale" });
  });
});

describe("text questions", () => {
  const shelters = { kind: "textQuestion", fieldId: "shelters", askedBefore: false } as const;
  test("words are masked and stored as typed; Tidak tahu, belum tahu and tidak ada are their states", () => {
    expect(states(apply(shelters, answer([], { shelters: "  masjid  dekat rumah Uji Satu " })))?.shelters).toEqual({
      state: "value",
      value: "masjid dekat rumah [nama pelapor]",
      origin: "boxEntry",
    });
    expect(states(apply(shelters, answer(["unknown"])))?.shelters).toEqual({
      state: "confirmedUnknown",
      origin: "tappedOption",
    });
    expect(states(apply(shelters, answer([], { shelters: "belum diketahui" })))?.shelters).toEqual({
      state: "confirmedUnknown",
      origin: "boxEntry",
    });
    expect(states(apply(shelters, answer([], { shelters: "Tidak ada" })))?.shelters).toEqual({
      state: "none",
      origin: "boxEntry",
    });
    expect(apply(shelters, answer(["unknown", "x"]))).toEqual({ kind: "stale" });
    expect(apply(shelters, answer(["x"]))).toEqual({ kind: "stale" });
  });

  test("300 characters pass, 301 are refused with the length; empty twice stays not yet known", () => {
    expect(states(apply(shelters, answer([], { shelters: "a".repeat(300) })))?.shelters).toMatchObject({
      state: "value",
    });
    expect(apply(shelters, answer([], { shelters: "a".repeat(301) }))).toEqual({
      kind: "invalid",
      errors: [
        { fieldId: "shelters", rule: "text.tooLong", params: { label: "field.shelters.label", length: 301, max: 300 } },
      ],
    });
    const once = apply(shelters, answer([], {}));
    expect(once).toEqual({
      kind: "applied",
      content: with_({ shelters: { state: "notYetKnown" } }),
      asked: { shelters: 1 },
    });
    const twice = apply(shelters, answer([], { shelters: " " }), EMPTY_CONTENT, { shelters: 1 });
    expect(twice).toEqual({
      kind: "applied",
      content: with_({ shelters: { state: "notYetKnown" } }),
      asked: { shelters: 2 },
    });
  });
});

describe("event time", () => {
  const time = { kind: "eventTime" } as const;
  const stored = (given: CardAnswer, zone: AnswerContext["zone"] = "WIB") => {
    const result = applyAnswer(time, given, EMPTY_CONTENT, {}, { ...context, zone }, null);
    return result.kind === "applied" ? result.content.states.eventTime : result;
  };
  test("today, yesterday and another date, each with or without a typed hour, in the zone of the place", () => {
    expect(stored(answer(["today"]))).toEqual({
      state: "value",
      value: { kind: "dateOnly", localDate: "2026-11-23", zone: "WIB" },
      origin: "tappedOption",
    });
    expect(stored(answer(["today"], { hour: " 09.05 " }))).toMatchObject({ value: { localTime: "09:05" } });
    expect(stored(answer(["yesterday"], { hour: "23.00" }))).toMatchObject({ value: { localTime: "23:00" } });
    expect(stored(answer(["yesterday"], { hour: "9.05" }), "WIT")).toEqual({
      state: "value",
      value: { kind: "dateTime", localDate: "2026-11-22", localTime: "09:05", zone: "WIT" },
      origin: "boxEntry",
    });
    expect(stored(answer(["otherDate"], { date: " 2026-11-20 ", hour: "" }))).toEqual({
      state: "value",
      value: { kind: "dateOnly", localDate: "2026-11-20", zone: "WIB" },
      origin: "boxEntry",
    });
    expect(stored(answer(["today", "hourUnknown"], { hour: "23:59", date: "2020-01-01" }))).toEqual({
      state: "value",
      value: { kind: "dateOnly", localDate: "2026-11-23", zone: "WIB" },
      origin: "tappedOption",
    });
    expect(stored(answer(["olderThan30Days"], { date: "x", hour: "y" }))).toEqual({
      state: "value",
      value: { kind: "olderThan30Days" },
      origin: "tappedOption",
    });
  });

  test("no date, a bad date, a bad hour, the future and over 30 days are refused at their field", () => {
    const error = (fieldId: string, rule: string, label: string) => ({
      kind: "invalid",
      errors: [{ fieldId, rule, params: { label } }],
    });
    expect(stored(answer([]))).toEqual(error("date", "time.dateRequired", "card.timeCard.date"));
    expect(stored(answer(["otherDate"], { date: " " }))).toEqual(
      error("date", "time.dateRequired", "card.timeCard.date"),
    );
    expect(stored(answer(["otherDate"]))).toEqual(error("date", "time.dateRequired", "card.timeCard.date"));
    expect(stored(answer(["otherDate"], { date: "2026-02-30" }))).toEqual(
      error("date", "time.dateRequired", "card.timeCard.date"),
    );
    expect(stored(answer([], { date: "2026-11-20" }))).toEqual(
      error("date", "time.dateRequired", "card.timeCard.date"),
    );
    for (const hour of ["24.00", "10.60", "1000", "x", "10.30x", "x10.30"])
      expect(stored(answer(["today"], { hour }))).toEqual(error("hour", "time.hourFormat", "card.timeCard.hour"));
    expect(stored(answer(["today"], { hour: "10.11" }))).toEqual(error("date", "time.inFuture", "card.timeCard.date"));
    expect(stored(answer(["today"], { hour: "10.10" }))).toMatchObject({ state: "value" });
    expect(stored(answer(["otherDate"], { date: "2026-10-23", hour: "09.59" }))).toEqual(
      error("date", "time.tooOld", "card.timeCard.date"),
    );
    expect(stored(answer(["otherDate"], { date: "2026-10-24", hour: "10.00" }))).toMatchObject({ state: "value" });
    expect(stored(answer(["later"]))).toEqual({ kind: "stale" });
  });
});

describe("guided chronology", () => {
  const typed = with_(flood);
  const step = (index: number) => ({ kind: "chronologyStep", step: index }) as const;
  test("a step adds its picks; a dangerous pick on a step with a warning marks that warning", () => {
    const first = apply(step(0), answer(["heavyRain"]), typed);
    expect(first.kind === "applied" && first.content.chronology).toEqual({ steps: [["heavyRain"]], otherText: {} });
    expect(first.kind === "applied" && first.content.danger).toBeNull();
    const second = apply(step(1), answer(["fastRise"]), first.kind === "applied" ? first.content : typed);
    expect(second.kind === "applied" && second.content.danger).toBe("chronology.flood.step2.warning");
    const safe = apply(step(1), answer(["slowRise"]), typed);
    expect(safe.kind === "applied" && safe.content.danger).toBeNull();
    const noWarning = apply(step(0), answer(["embankmentBreach"]), with_({ hazardType: tapped("buildingFire") }));
    expect(noWarning.kind).toBe("stale");
  });

  test("a single step takes one pick, a multiple step several, never an exclusive one with others", () => {
    expect(apply(step(0), answer([]), typed)).toEqual({
      kind: "invalid",
      errors: [{ fieldId: "options", rule: "required", params: { label: "chronology.flood.step1.question" } }],
    });
    expect(apply(step(0), answer(["heavyRain", "riverRising"]), typed)).toEqual({ kind: "stale" });
    expect(apply(step(0), answer(["nope"]), typed)).toEqual({ kind: "stale" });
    expect(apply(step(2), answer(["homes", "unknown"]), typed)).toEqual({
      kind: "invalid",
      errors: [
        {
          fieldId: "options",
          rule: "exclusiveWithOthers",
          params: { label: "chronology.flood.step3.question", option: "chronology.flood.step3.option.unknown.label" },
        },
      ],
    });
    const alone = apply(step(2), answer(["unknown"]), typed);
    expect(alone.kind === "applied" && alone.content.chronology?.steps).toEqual([["unknown"]]);
    expect(apply(step(2), answer(["homes", "other"]), typed)).toMatchObject({
      kind: "invalid",
      errors: [{ fieldId: "other", rule: "required" }],
    });
    const mixed = apply(
      step(3),
      answer(["roadsBlocked", "residentsTrapped"]),
      with_(flood, { chronology: { steps: [["a"], ["b"], ["c"]], otherText: {} } }),
    );
    expect(mixed.kind === "applied" && mixed.content.danger).toBe("chronology.flood.step4.warning");
    const several = apply(step(2), answer(["homes", "roads"]), typed);
    expect(several.kind === "applied" && several.content.chronology?.steps).toEqual([["homes", "roads"]]);
  });

  test("Lainnya needs words, at most 300, kept masked by step", () => {
    const label = "chronology.flood.step3.option.other.label";
    expect(apply(step(2), answer(["other"]), typed)).toEqual({
      kind: "invalid",
      errors: [{ fieldId: "other", rule: "required", params: { label } }],
    });
    expect(apply(step(2), answer(["other"], { other: "a".repeat(301) }), typed)).toEqual({
      kind: "invalid",
      errors: [{ fieldId: "other", rule: "text.tooLong", params: { label, length: 301, max: 300 } }],
    });
    const kept = apply(
      step(2),
      answer(["other"], { other: "Lapangan milik Uji Satu" }),
      with_(flood, { chronology: { steps: [["a"], ["b"]], otherText: { 0: "x" } } }),
    );
    expect(kept.kind === "applied" && kept.content.chronology).toEqual({
      steps: [["a"], ["b"], ["other"]],
      otherText: { 0: "x", 2: "Lapangan milik [nama pelapor]" },
    });
    expect(apply(step(2), answer(["other"], { other: "a".repeat(300) }), typed).kind).toBe("applied");
  });

  test("the review stores the joined chronology with the masked note; Tidak ada, lanjut ignores the box", () => {
    const answered = with_(flood, { chronology: { steps: [["heavyRain"]], otherText: {} } });
    const review = { kind: "chronologyReview" } as const;
    const saved = apply(review, answer(["add"], { note: "air dari Uji Satu" }), answered);
    expect(saved.kind === "applied" && saved.content.states.chronology).toEqual({
      state: "value",
      value: {
        steps: [["heavyRain"]],
        otherText: {},
        note: "air dari [nama pelapor]",
        text: "phrase heavyRain air dari [nama pelapor].",
      },
      origin: "tappedOption",
    });
    expect(saved.kind === "applied" && saved.content.chronology).toBeNull();
    const done = apply(review, answer(["done"], { note: "ignored" }), answered);
    expect(done.kind === "applied" && done.content.states.chronology).toMatchObject({
      value: { note: null, text: "phrase heavyRain." },
    });
    const bare = apply(review, answer([], {}), with_(flood));
    expect(bare.kind === "applied" && bare.content.states.chronology).toMatchObject({
      value: { steps: [], note: null },
    });
    expect(apply(review, answer(["x"]), answered)).toEqual({ kind: "stale" });
    expect(apply(review, answer(["add", "done"]), answered)).toEqual({ kind: "stale" });
  });

  test("a note of 301 and a whole chronology over 500 are refused, 300 and 500 pass", () => {
    const review = { kind: "chronologyReview" } as const;
    const answered = with_(flood, { chronology: { steps: [["heavyRain"]], otherText: {} } });
    const label = "field.chronology.label";
    expect(apply(review, answer([], { note: "a".repeat(301) }), answered)).toEqual({
      kind: "invalid",
      errors: [{ fieldId: "note", rule: "text.tooLong", params: { label, length: 301, max: 300 } }],
    });
    const long = { ...context, phraseOf: () => "b".repeat(199) };
    const whole = (note: number) =>
      applyAnswer(review, answer([], { note: "a".repeat(note) }), answered, {}, long, null);
    expect(whole(299).kind).toBe("applied");
    expect(whole(300)).toEqual({
      kind: "invalid",
      errors: [{ fieldId: "note", rule: "text.tooLong", params: { label, length: 501, max: 500 } }],
    });
  });
});
