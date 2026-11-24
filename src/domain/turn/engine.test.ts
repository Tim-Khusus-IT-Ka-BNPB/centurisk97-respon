import { describe, expect, test } from "vitest";
import { type Extraction, validateExtraction } from "../extraction";
import type { FieldState, FieldStates } from "../fieldState";
import { type MaskedText, maskText } from "../masking";
import type { AnswerContext } from "./answer";
import { type DraftContent, EMPTY_CONTENT } from "./content";
import { runTurn, type TurnDraft, type TurnInput } from "./engine";
import { applyStory, classifyFreeText } from "./freeText";

const NOW = Date.parse("2026-11-23T03:00:00.000Z");
const context: AnswerContext = {
  nowMs: NOW,
  zone: "WIB",
  reporter: { name: "Uji Satu", number: null },
  phraseOf: (key) => key,
  photoCount: 0,
};
const tapped = (value: string): FieldState => ({ state: "value", value, origin: "tappedOption" });
const unknown: FieldState = { state: "confirmedUnknown", origin: "tappedOption" };
const placed: FieldStates = {
  place: {
    state: "value",
    value: {
      villageCode: "11.08.01.2001",
      precision: "villageLevel",
      snapshotId: 1,
      villageName: "A",
      districtName: "B",
      regencyName: "C",
      provinceName: "D",
    },
    origin: "tappedOption",
  },
  neighbourhood: unknown,
};
const draft = (
  states: FieldStates,
  extra: Partial<TurnDraft> = {},
  content: Partial<DraftContent> = {},
): TurnDraft => ({
  state: "asking",
  content: { ...EMPTY_CONTENT, states, photosDone: "cannotSend", ...content },
  asked: {},
  backStack: [],
  offTopicCount: 0,
  templatesOnly: false,
  ...extra,
});
const said = (text: string): MaskedText => maskText(text, { name: null, number: null });
const nothing: Extraction = { fields: {}, hazardGuesses: [], lifeAtRisk: false, reply: null, topic: "disaster" };
const story = (text: string, extraction: Partial<Extraction> = {}): TurnInput => ({
  kind: "story",
  message: said(text),
  extraction: { ...nothing, ...extraction },
});
const run = (from: TurnDraft, input: TurnInput) => runTurn(from, input, context);
const next = (from: TurnDraft, input: TurnInput) => {
  const outcome = run(from, input);
  if (outcome.kind !== "next") throw new Error(outcome.kind);
  return outcome;
};

describe("typed words before anything else", () => {
  test.each([
    ["kembali", "back"],
    [" Balik. ", "back"],
    ["salah pilih", "back"],
    ["undo", "back"],
    ["Batal", "cancel"],
    ["batalkan laporan!", "cancel"],
    ["batalkan", "cancel"],
    ["balik.!", "back"],
    ["un.do", "story"],
    ["saya kembali", "story"],
    ["kembali lagi", "story"],
    ["jangan batal", "story"],
    ["batalkan saja", "story"],
  ])("%s is %s", (text, kind) => {
    expect(classifyFreeText(text)).toEqual({ kind });
  });

  test("2,000 characters are a story, 2,001 too long; off-topic and data requests are refused by code", () => {
    expect(classifyFreeText("a".repeat(2000))).toEqual({ kind: "story" });
    expect(classifyFreeText("a".repeat(2001))).toEqual({ kind: "tooLong", length: 2001 });
    expect(classifyFreeText("buatkan puisi tentang hujan")).toEqual({ kind: "refused", topic: "offTopic" });
    expect(classifyFreeText("minta data semua pelapor di desa ini")).toEqual({ kind: "refused", topic: "dataRequest" });
    expect(classifyFreeText("kembali ke rumah, air naik")).toEqual({ kind: "story" });
  });
});

describe("a turn", () => {
  test("an answer moves on and remembers where it was, for kembali", () => {
    const from = draft(placed);
    const moved = next(from, { kind: "answer", answer: { optionIds: ["flood"], values: {} }, village: null });
    expect(moved.question).toEqual({ kind: "choice", fieldId: "hazardSubtype" });
    expect(moved.draft.backStack).toEqual([{ state: "asking", content: from.content, asked: {} }]);
    const back = next(moved.draft, { kind: "back" });
    expect(back.question).toEqual({ kind: "choice", fieldId: "hazardType" });
    expect(back.draft.content.states.hazardType).toBeUndefined();
    expect(back.draft.backStack).toEqual([]);
    expect(back.notices).toEqual([]);
  });

  test("kembali keeps 12 steps; with none left it is a limit, or nothing to undo before any answer", () => {
    let current = draft(placed);
    for (let step = 0; step < 14; step += 1) current = next(current, story(`air ${step + 1} cm`)).draft;
    expect(current.backStack).toHaveLength(12);
    for (let step = 0; step < 12; step += 1) current = next(current, { kind: "back" }).draft;
    expect(run(current, { kind: "back" })).toEqual({ kind: "backRefused", code: "draft.backLimit" });
    expect(run(draft({}), { kind: "back" })).toEqual({ kind: "backRefused", code: "draft.nothingToUndo" });
    expect(run(draft({}, {}, { chronology: { steps: [["a"]], otherText: {} } }), { kind: "back" })).toEqual({
      kind: "backRefused",
      code: "draft.backLimit",
    });
    expect(run(draft({}, {}, { chronology: { steps: [], otherText: {} } }), { kind: "back" })).toEqual({
      kind: "backRefused",
      code: "draft.nothingToUndo",
    });
  });

  test("Batal opens the confirm; kembali, dismiss or a story leave it open or close it with nothing changed; confirm cancels", () => {
    const from = draft(placed, {}, { danger: "x" });
    const asked = next(from, { kind: "cancel" });
    expect(asked.question).toEqual({ kind: "cancelConfirm" });
    expect(asked.notices).toEqual([]);
    const atConfirm = next(
      asked.draft,
      story("dua meninggal", { fields: { dead: { kind: "count", count: 2, quote: "dua meninggal" } } }),
    );
    expect(atConfirm).toMatchObject({ question: { kind: "cancelConfirm" }, notices: [] });
    expect(atConfirm.draft.content.states).toEqual(placed);
    const closed = next(asked.draft, { kind: "back" });
    expect(closed.notices).toEqual([]);
    expect(closed.question).toEqual({ kind: "choice", fieldId: "hazardType" });
    expect(closed.draft.content.states).toEqual(placed);
    expect(next(asked.draft, { kind: "dismiss" }).question).toEqual({ kind: "choice", fieldId: "hazardType" });
    expect(run(asked.draft, { kind: "confirm" })).toEqual({ kind: "cancelled" });
    expect(run(from, { kind: "confirm" })).toEqual({ kind: "stale" });
    expect(run(from, { kind: "dismiss" })).toEqual({ kind: "stale" });
  });

  test("Ubah works on the summary only", () => {
    const summary = draft({ ...placed }, { state: "summary" });
    expect(run(draft(placed), { kind: "editGroup", groupId: "victims" })).toEqual({ kind: "stale" });
    const all = floodSummary();
    const edit = next(all, { kind: "editGroup", groupId: "victims" });
    expect(edit.notices).toEqual([]);
    expect(edit.draft.content.overlay).toEqual({ kind: "edit", groupId: "victims", done: [] });
    expect(edit.question).toMatchObject({ kind: "numberForm", groupId: "victims" });
    expect(edit.draft.state).toBe("asking");
    expect(summary.state).toBe("summary");
  });

  test("the summary adds the 112 line; a dangerous pick shows its warning once under the next question", () => {
    expect(next(floodSummary(), story("air naik")).notices).toEqual([{ kind: "lifeLine" }]);
    const stepped = next(
      draft(
        { ...placed, hazardType: tapped("flood"), hazardSubtype: tapped("flashFlood") },
        { state: "guided_chronology" },
        { chronology: { steps: [["heavyRain"]], otherText: {} } },
      ),
      {
        kind: "answer",
        answer: { optionIds: ["suddenTorrent"], values: {} },
        village: null,
      },
    );
    expect(stepped.notices).toEqual([{ kind: "danger", copyKey: "chronology.flood.step2.warning" }]);
    expect(stepped.draft.content.danger).toBeNull();
  });

  test("a refused message counts; the third turns the draft to templates once, with its own line", () => {
    const first = next(draft(placed), { kind: "refused", topic: "offTopic" });
    expect(first.notices).toEqual([{ kind: "refusal", copyKey: "refusal.offTopic" }]);
    expect(first.draft).toMatchObject({ offTopicCount: 1, templatesOnly: false });
    const third = next({ ...first.draft, offTopicCount: 2 }, { kind: "refused", topic: "dataRequest" });
    expect(third.notices).toEqual([
      { kind: "refusal", copyKey: "refusal.dataRequest" },
      { kind: "refusal", copyKey: "refusal.templatesOnly" },
    ]);
    expect(third.draft).toMatchObject({ offTopicCount: 3, templatesOnly: true });
    expect(next(third.draft, { kind: "refused", topic: "offTopic" }).notices).toEqual([
      { kind: "refusal", copyKey: "refusal.offTopic" },
    ]);
    expect(next(draft(placed), story("x", { topic: "dataRequest" })).notices).toEqual([
      { kind: "refusal", copyKey: "refusal.dataRequest" },
    ]);
    expect(next(draft(placed), story("x", { topic: "offTopic" }))).toMatchObject({
      draft: { offTopicCount: 1 },
      notices: [{ kind: "refusal", copyKey: "refusal.offTopic" }],
    });
  });

  test("the model's topic label does not refuse a message whose checked values survive", () => {
    const quoted = { housesHeavy: { kind: "count" as const, count: 2, quote: "dua rumah rusak berat" } };
    const kept = next(draft(placed), story("dua rumah rusak berat", { fields: quoted, topic: "offTopic" }));
    expect(kept.notices).toEqual([]);
    expect(kept.draft).toMatchObject({ offTopicCount: 0, templatesOnly: false });
    expect(kept.draft.content.states.housesHeavy).toEqual({
      state: "value",
      value: 2,
      origin: "quote",
      quote: "dua rumah rusak berat",
    });
    const guessed = next(
      draft(placed),
      story("air naik", { hazardGuesses: [{ hazardType: "flood", subtype: null }], topic: "dataRequest" }),
    );
    expect(guessed.draft.offTopicCount).toBe(0);
    expect(guessed.draft.content.guesses).toEqual(["flood"]);
    const both = next(
      draft(placed),
      story("dua rumah rusak berat", {
        fields: quoted,
        hazardGuesses: [{ hazardType: "flood", subtype: null }],
        topic: "offTopic",
      }),
    );
    expect(both.draft.offTopicCount).toBe(0);
  });

  test("a story stores what its quotes hold, raises the 112 line on a life at risk, and refuses a bad time", () => {
    const told = next(
      draft(placed),
      story("dua rumah rusak berat", {
        fields: { housesHeavy: { kind: "count", count: 2, quote: "dua rumah rusak berat" } },
        lifeAtRisk: true,
      }),
    );
    expect(told.draft.content.states.housesHeavy).toEqual({
      state: "value",
      value: 2,
      origin: "quote",
      quote: "dua rumah rusak berat",
    });
    expect(told.notices).toEqual([{ kind: "lifeLine" }]);
    expect(told.draft.backStack).toHaveLength(1);
    const atTime = draft({ ...floodSummary().content.states, eventTime: undefined } as FieldStates);
    expect(run(atTime, story("besok pagi"))).toEqual({
      kind: "invalid",
      errors: [{ fieldId: "date", rule: "time.dateRequired", params: { label: "card.timeCard.date" } }],
    });
    expect(run(draft(placed), { kind: "answer", answer: { optionIds: ["nope"], values: {} }, village: null })).toEqual({
      kind: "stale",
    });
  });

  test("a move the state map forbids is a fault", () => {
    expect(() => run({ ...draft(placed), state: "sent" }, story("x"))).toThrow("No move from sent to asking");
  });
});

function floodSummary(): TurnDraft {
  const states: Record<string, FieldState> = {
    ...placed,
    hazardType: tapped("flood"),
    hazardSubtype: tapped("riverOverflow"),
    chronology: { state: "value", value: { steps: [], otherText: {}, note: null, text: "" }, origin: "tappedOption" },
    eventTime: { state: "value", value: { kind: "olderThan30Days" }, origin: "tappedOption" },
  };
  for (const id of [
    "dead",
    "missing",
    "injured",
    "affectedFamilies",
    "affectedPeople",
    "displacedPeople",
    "displacedFamilies",
    "housesHeavy",
    "housesModerate",
    "housesLight",
    "housesFlooded",
    "schools",
    "healthFacilities",
    "worshipPlaces",
    "roads",
    "vulnerableGroups",
    "disruptedServices",
    "waterDepth",
    "farmland",
    "urgentNeeds",
  ])
    states[id] = unknown;
  return draft(states, { state: "summary" });
}

describe("a story applied", () => {
  const question = {
    kind: "numberForm",
    groupId: "victims",
    fieldIds: ["dead", "missing"],
    askedBefore: false,
  } as const;
  const apply = (
    states: FieldStates,
    text: string,
    fields: Extraction["fields"] = {},
    content: Partial<DraftContent> = {},
    at = question as Parameters<typeof applyStory>[0],
  ) => applyStory(at, { ...EMPTY_CONTENT, states, ...content }, {}, said(text), { ...nothing, fields }, context);

  test("never replaces a settled answer, except on the summary or in a reopened group", () => {
    const fields = { dead: { kind: "count", count: 3, quote: "tiga meninggal" } } as const;
    const settled = { dead: { state: "none", origin: "boxEntry" } } as FieldStates;
    expect(apply(settled, "tiga meninggal", fields)).toMatchObject({
      kind: "applied",
      changed: [],
      content: { states: settled },
    });
    expect(apply({ dead: { state: "notYetKnown" } }, "tiga meninggal", fields)).toMatchObject({ changed: ["dead"] });
    expect(apply(settled, "tiga meninggal", fields, {}, { kind: "summary" })).toMatchObject({ changed: ["dead"] });
    const edit = apply(settled, "tiga meninggal", fields, { overlay: { kind: "edit", groupId: "victims", done: [] } });
    expect(edit).toMatchObject({
      changed: ["dead"],
      content: { overlay: { kind: "edit", groupId: "victims", done: ["dead", "missing"] } },
    });
    const mixed = apply(
      {},
      "x",
      { dead: { kind: "count", count: 3, quote: "x" }, housesHeavy: { kind: "count", count: 2, quote: "x" } },
      { overlay: { kind: "edit", groupId: "victims", done: [] } },
    );
    expect(mixed).toMatchObject({ content: { overlay: { done: ["dead", "missing"] } } });
    const elsewhere = apply(
      {},
      "dua rumah",
      { housesHeavy: { kind: "count", count: 2, quote: "dua rumah" } },
      { overlay: { kind: "edit", groupId: "victims", done: [] } },
    );
    expect(elsewhere).toMatchObject({ content: { overlay: { done: [] } } });
  });

  test("a none from a quote, a text value, guesses kept first, and values of a type the draft is not keep out", () => {
    const result = apply(
      { hazardType: tapped("drought") },
      "tidak ada korban jiwa",
      {
        dead: { kind: "count", count: 0, quote: "tidak ada korban jiwa" },
        housesHeavy: { kind: "count", count: 2, quote: "x" },
        shelters: { kind: "text", text: "balai desa", quote: "ke balai desa" },
      },
      { guesses: ["drought"] },
    );
    expect(result.kind === "applied" && result.content.states).toEqual({
      hazardType: tapped("drought"),
      dead: { state: "none", origin: "quote", quote: "tidak ada korban jiwa" },
      shelters: { state: "value", value: "balai desa", origin: "quote", quote: "ke balai desa" },
    });
    const guessed = applyStory(
      { kind: "place" },
      { ...EMPTY_CONTENT, guesses: ["flood"] },
      {},
      said("x"),
      {
        ...nothing,
        hazardGuesses: [
          { hazardType: "landslide", subtype: null },
          { hazardType: "flood", subtype: null },
        ],
      },
      context,
    );
    expect(guessed.kind === "applied" && guessed.content.guesses).toEqual(["landslide", "flood"]);
  });

  test("the card's own answer in words: belum tahu, tidak ada, a text, a time", () => {
    expect(apply({}, "Belum tahu.")).toMatchObject({
      content: {
        states: {
          dead: { state: "confirmedUnknown", origin: "quote", quote: "Belum tahu." },
          missing: { state: "confirmedUnknown" },
        },
      },
    });
    expect(apply({}, "nihil")).toMatchObject({ content: { states: { dead: { state: "none" } } } });
    expect(apply({}, "dua orang")).toMatchObject({ changed: [] });
    expect(apply({}, "belum tahu.!")).toMatchObject({ content: { states: { dead: { state: "confirmedUnknown" } } } });
    expect(apply({}, "belum tahu", {}, {}, { kind: "choice", fieldId: "hazardType" })).toMatchObject({ changed: [] });
    for (const text of ["ti.dak ada", "saya belum tahu", "belum tahu juga", "air tidak ada", "tidak ada lagi"])
      expect(apply({}, text), text).toMatchObject({ changed: [] });
    const text = { kind: "textQuestion", fieldId: "shelters", askedBefore: false } as const;
    expect(
      apply({ displacedPeople: { state: "value", value: 2, origin: "boxEntry" } }, "di masjid", {}, {}, text),
    ).toMatchObject({
      content: { states: { shelters: { state: "value", value: "di masjid", origin: "quote", quote: "di masjid" } } },
    });
    expect(apply({}, "tadi jam 9 pagi", {}, {}, { kind: "eventTime" })).toMatchObject({
      content: {
        states: {
          eventTime: {
            state: "value",
            value: { kind: "dateTime", localDate: "2026-11-23", localTime: "09:00", zone: "WIB" },
            origin: "quote",
          },
        },
      },
    });
    expect(apply({}, "tanggal 31/02/2026", {}, {}, { kind: "eventTime" })).toEqual({
      kind: "invalid",
      errors: [{ fieldId: "date", rule: "time.dateRequired", params: { label: "card.timeCard.date" } }],
    });
    expect(apply({}, "besok", {}, {}, { kind: "eventTime" })).toEqual({
      kind: "invalid",
      errors: [{ fieldId: "date", rule: "time.dateRequired", params: { label: "card.timeCard.date" } }],
    });
    expect(apply({}, "tanggal 1 desember 2026", {}, {}, { kind: "eventTime" })).toEqual({
      kind: "invalid",
      errors: [{ fieldId: "date", rule: "time.inFuture", params: { label: "card.timeCard.date" } }],
    });
    expect(apply({}, "tidak ada", {}, {}, { kind: "place" })).toMatchObject({ content: { states: {} } });
  });

  test("a story with words the model wrote, checked by the extraction rule, keeps only what the message holds", () => {
    const message = said("tiga rumah rusak berat, tidak ada korban jiwa");
    const kept = validateExtraction(
      {
        fields: [
          { field: "housesHeavy", value: "3", quote: "tiga rumah rusak berat" },
          { field: "injured", value: "5", quote: "tiga rumah rusak berat" },
        ],
      },
      message,
      null,
    );
    const result = applyStory({ kind: "place" }, EMPTY_CONTENT, {}, message, kept, context);
    expect(result.kind === "applied" && Object.keys(result.content.states)).toEqual(["housesHeavy"]);
  });
});

describe("a GPS reading", () => {
  const read = {
    villageCode: "11.08.01.2001",
    precision: "gpsPoint" as const,
    point: { lat: 5.1, lon: 97.1, accuracyM: 12 },
    snapshotId: 1,
    villageName: "A",
    districtName: "B",
    regencyName: "C",
    provinceName: "D",
  };
  const found = {
    kind: "located" as const,
    result: { kind: "found" as const, reading: { village: read, nearby: [] } },
  };
  test("is taken on the place card and again on the confirm card, and refused anywhere else", () => {
    const start = draft({}, { state: "place" });
    const reading = next(start, found);
    expect(reading.question).toEqual({ kind: "placeConfirm" });
    expect(reading.draft.state).toBe("place_confirm");
    expect(reading.draft.backStack).toHaveLength(1);
    expect(next(reading.draft, found).question).toEqual({ kind: "placeConfirm" });
    expect(run(draft(placed), found)).toEqual({ kind: "stale" });
  });

  test("a point outside, not found or unreadable leaves the draft at the place card with the reason", () => {
    for (const kind of ["outside", "notFound", "unavailable"] as const) {
      const refused = next(draft({}, { state: "place" }), { kind: "located", result: { kind } });
      expect(refused.question).toEqual({ kind: "place" });
      expect(refused.notices).toEqual([{ kind: "refusal", copyKey: `refusal.place.${kind}` }]);
      expect(refused.draft.backStack).toEqual([]);
    }
  });
});
