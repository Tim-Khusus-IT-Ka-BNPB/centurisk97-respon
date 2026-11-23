import type { Card, CardKind } from "../contract/card";
import type { DraftBody, MeResponse } from "../contract/draft";
import type { ErrorEnvelope } from "../contract/errors";
import { EMPTY_CONTENT } from "../domain/turn/content";
import { cardFor } from "../services/cards";

// One draft body per card kind, for component tests and for building screens before the
// turn engine exists. Every sample parses against the contract schemas (see samples.test.ts).
const DRAFT_ID = "0b4c5d6e-7f80-4912-a3b4-c5d6e7f80912";
const at = (utc: string) => ({ utc, zone: "WIB" as const });
const option = (labelKey: string, id: string) => ({
  id,
  labelKey,
  noteKey: null as string | null,
  exclusive: false,
  danger: false,
  guess: false,
  freeTextMaxLength: null,
});
const countBox = (id: string, max: number, askedBefore = false) => ({
  id,
  inputKind: "integer" as const,
  labelKey: `field.${id}.label`,
  definitionKey: `field.${id}.definition`,
  min: 0,
  max,
  maxLength: null,
  value: null,
  state: askedBefore ? ("notYetKnown" as const) : ("notAsked" as const),
  origin: null,
  askedBefore,
});
const textBox = (id: string, labelKey: string, maxLength: number) => ({
  id,
  inputKind: "text" as const,
  labelKey,
  definitionKey: null,
  min: null,
  max: null,
  maxLength,
  value: null,
  state: "notAsked" as const,
  origin: null,
  askedBefore: false,
});

const lifeLine = { kind: "lifeLine" as const, copyKey: "notice.lifeLine", params: {}, retryAt: null };

function draft(state: DraftBody["state"], card: Card, extra: Partial<DraftBody> = {}): DraftBody {
  return {
    draftId: DRAFT_ID,
    revision: 3,
    state,
    card,
    transcript: [
      {
        speaker: "assistant",
        cardKind: "placeSearch",
        copyKey: "card.placeSearch.prompt",
        params: {},
        at: at("2026-11-23T01:00:00.000Z"),
      },
      { speaker: "reporter", textMasked: "air masuk rumah [nama pelapor]", at: at("2026-11-23T01:01:00.000Z") },
    ],
    notices: [],
    completePercent: 17,
    keptUntil: at("2026-11-24T01:01:00.000Z"),
    canGoBack: true,
    freeTextAllowed: false,
    turnKey: null,
    ...extra,
  };
}

const card = { cardId: "c-3", params: {} };
const village = {
  level: "village" as const,
  code: "11.08.01.2001",
  name: "Sukamaju",
  districtName: "Contoh",
  regencyName: "Aceh Utara",
  provinceName: "Aceh",
};

export const SAMPLE_DRAFTS: Readonly<Record<CardKind, DraftBody>> = {
  placeSearch: draft(
    "place",
    {
      ...card,
      kind: "placeSearch",
      titleKey: "card.placeSearch.title",
      promptKey: "card.placeSearch.prompt",
      query: "sukamaju",
      places: { items: [village], total: 71, cut: true, dataDate: "2026-10-25" },
    },
    { notices: [lifeLine], canGoBack: false, completePercent: 0 },
  ),
  regencyVillages: draft("place", {
    ...card,
    kind: "regencyVillages",
    titleKey: "card.regencyVillages.title",
    promptKey: "card.regencyVillages.prompt",
    params: { areaName: "Aceh Utara" },
    areaCode: "11.08",
    areaLevel: "regency",
    query: null,
    places: { items: [village], total: 844, cut: true, dataDate: "2026-10-25" },
  }),
  // Drawn by the engine's own card builder, so the sample cannot drift from what is sent.
  neighbourhood: draft(
    "neighbourhood",
    cardFor({ kind: "neighbourhood" }, EMPTY_CONTENT, {
      cardId: card.cardId,
      nowMs: Date.parse("2026-11-24T03:00:00.000Z"),
      zone: "WIB",
      reporter: { name: "Uji Satu", role: "citizen" },
      completePercent: 0,
      asked: {},
    }),
  ),
  choice: draft("asking", {
    ...card,
    kind: "choice",
    titleKey: "card.choice.hazardType.title",
    promptKey: "card.choice.hazardType.prompt",
    fieldId: "hazardType",
    options: ["flood", "landslide", "earthquake"].map((id) => ({
      ...option(`hazard.${id}.label`, id),
      noteKey: `hazard.${id}.note`,
    })),
  }),
  multiChoice: draft("asking", {
    ...card,
    kind: "multiChoice",
    titleKey: "field.vulnerableGroups.label",
    promptKey: "field.vulnerableGroups.question",
    fieldId: "vulnerableGroups",
    options: [
      option("option.vulnerableGroups.elderly.label", "elderly"),
      { ...option("option.vulnerableGroups.none.label", "none"), exclusive: true },
      { ...option("option.vulnerableGroups.unknown.label", "unknown"), exclusive: true },
    ],
  }),
  numberForm: draft("asking", {
    ...card,
    kind: "numberForm",
    titleKey: "group.victims.label",
    promptKey: "card.numberForm.prompt",
    groupId: "victims",
    fields: [countBox("dead", 100_000), countBox("missing", 100_000, true), countBox("injured", 1_000_000)],
    formActions: ["allNone", "allUnknown"],
  }),
  timeCard: draft("asking", {
    ...card,
    kind: "timeCard",
    titleKey: "card.timeCard.title",
    promptKey: "card.timeCard.prompt",
    params: { zone: "WIT" },
    zone: "WIT",
    fields: [
      {
        ...textBox("date", "card.timeCard.date", 10),
        inputKind: "date",
        min: "2026-10-24",
        max: "2026-11-23",
        maxLength: null,
      },
      { ...textBox("hour", "card.timeCard.hour", 5), inputKind: "hour", maxLength: null },
    ],
    options: ["today", "yesterday", "otherDate", "hourUnknown", "olderThan30Days"].map((id) =>
      option(`card.timeCard.${id}`, id),
    ),
  }),
  textQuestion: draft("asking", {
    ...card,
    kind: "textQuestion",
    titleKey: "field.shelters.label",
    promptKey: "field.shelters.question",
    params: { max: 300 },
    fieldId: "shelters",
    fields: [textBox("shelters", "field.shelters.label", 300)],
  }),
  chronologyStep: draft("guided_chronology", {
    ...card,
    kind: "chronologyStep",
    titleKey: "card.chronologyStep.progress",
    promptKey: "chronology.flood.step2.question",
    params: { step: 2, total: 8 },
    hazardType: "flood",
    step: 2,
    total: 8,
    multiple: false,
    options: [
      option("chronology.flood.step2.option.slowRise.label", "slowRise"),
      { ...option("chronology.flood.step2.option.fastRise.label", "fastRise"), danger: true },
      { ...option("chronology.flood.step2.option.suddenTorrent.label", "suddenTorrent"), danger: true },
      option("chronology.flood.step2.option.unknown.label", "unknown"),
    ],
  }),
  chronologyReview: draft("guided_chronology", {
    ...card,
    kind: "chronologyReview",
    titleKey: "card.chronologyReview.title",
    promptKey: "card.chronologyReview.prompt",
    chronology: {
      kind: "chronology",
      hazardType: "flood",
      steps: [
        { step: 1, optionIds: ["heavyRain"], otherText: null },
        { step: 3, optionIds: ["homes", "other"], otherText: "lapangan bola" },
      ],
      note: null,
      text: "Hujan dengan intensitas tinggi turun dalam waktu lama. Genangan merendam lapangan bola.",
    },
    fields: [textBox("note", "card.chronologyReview.noteHint", 300)],
  }),
  summary: draft(
    "summary",
    {
      ...card,
      kind: "summary",
      titleKey: "card.summary.title",
      promptKey: null,
      params: { percent: 62 },
      reporter: { name: "Uji Satu", role: "claimedOfficer" },
      groups: [
        {
          groupId: "event",
          rows: [
            {
              fieldId: "hazardType",
              state: "value",
              value: { kind: "hazardType", hazardType: "flood" },
              origin: "tappedOption",
            },
            {
              fieldId: "eventTime",
              state: "value",
              value: { kind: "eventTime", time: { kind: "dateOnly", localDate: "2026-11-23", zone: "WIT" } },
              origin: "tappedOption",
            },
          ],
        },
        {
          groupId: "victims",
          rows: [
            { fieldId: "dead", state: "none", value: null, origin: "boxEntry" },
            { fieldId: "missing", state: "confirmedUnknown", value: null, origin: "boxEntry" },
            { fieldId: "injured", state: "notYetKnown", value: null, origin: null },
          ],
        },
        {
          groupId: "houses",
          rows: [{ fieldId: "housesHeavy", state: "value", value: { kind: "count", count: 3 }, origin: "quote" }],
        },
      ],
    },
    { notices: [lifeLine], completePercent: 62 },
  ),
  confirm: draft("summary", {
    ...card,
    kind: "confirm",
    titleKey: "card.confirm.cancelDraft.title",
    promptKey: "card.confirm.cancelDraft.body",
    confirmId: "cancelDraft",
  }),
  sent: draft(
    "sent",
    {
      ...card,
      kind: "sent",
      titleKey: "card.sent.title",
      promptKey: "card.sent.body",
      params: { ticketNumber: "LA-231126-01" },
      ticketNumber: "LA-231126-01",
      sentAt: at("2026-11-23T02:00:00.000Z"),
    },
    { canGoBack: false },
  ),
  cancelled: draft(
    "cancelled",
    { ...card, kind: "cancelled", titleKey: "card.cancelled.title", promptKey: "card.cancelled.body" },
    { canGoBack: false, transcript: [] },
  ),
};

export const SAMPLE_STALE_TURN: ErrorEnvelope = {
  error: { code: "draft.changed", copyKey: "error.draft.changed", params: {} },
  fields: [],
  retryAt: null,
  draft: SAMPLE_DRAFTS.numberForm,
};

export const SAMPLE_FIELD_ERROR: ErrorEnvelope = {
  error: { code: "request.invalidFields", copyKey: "error.request.invalidFields", params: {} },
  fields: [{ fieldId: "name", copyKey: "fieldError.name.digits", params: { label: "Nama" } }],
  retryAt: null,
  draft: null,
};

export const SAMPLE_ME: MeResponse = {
  knownReporters: [
    {
      profileId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      name: "Uji Satu",
      maskedNumber: "0800****0001",
      role: "citizen",
      lastUsedAt: at("2026-11-23T01:00:00.000Z"),
      openDraft: { draftId: DRAFT_ID, hazardType: null, lastActedAt: at("2026-11-23T01:01:00.000Z") },
    },
  ],
  privacyVersion: 1,
  session: null,
};
