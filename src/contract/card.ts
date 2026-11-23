import { z } from "zod";
import {
  copyKeySchema,
  fieldStateSchema,
  hazardTypeSchema,
  paramsSchema,
  reporterRoleSchema,
  timeSchema,
  valueOriginSchema,
  zoneSchema,
} from "./common";

export const CARD_KINDS = [
  "placeSearch",
  "regencyVillages",
  "neighbourhood",
  "choice",
  "multiChoice",
  "numberForm",
  "timeCard",
  "textQuestion",
  "chronologyStep",
  "chronologyReview",
  "summary",
  "confirm",
  "sent",
  "cancelled",
] as const;
export type CardKind = (typeof CARD_KINDS)[number];

// One input on a card. On a date input min and max are local dates in the province zone.
const cardFieldSchema = z.object({
  id: z.string(),
  inputKind: z.enum(["integer", "digits", "text", "date", "hour"]),
  labelKey: copyKeySchema,
  definitionKey: copyKeySchema.nullable(),
  min: z.union([z.number(), z.string()]).nullable(),
  max: z.union([z.number(), z.string()]).nullable(),
  maxLength: z.number().int().positive().nullable(),
  value: z.union([z.string(), z.number()]).nullable(),
  state: fieldStateSchema,
  origin: valueOriginSchema.nullable(),
  // "Masih kosong." shows under a box asked for the second time.
  askedBefore: z.boolean(),
});

const cardOptionSchema = z.object({
  id: z.string(),
  labelKey: copyKeySchema,
  noteKey: copyKeySchema.nullable(),
  exclusive: z.boolean(),
  danger: z.boolean(),
  // A hazard type guessed from the reporter's words; guesses come first on the hazard card. The
  // server always sends it; it is optional only until the app's test fixtures carry it.
  guess: z.boolean().optional(),
  // Picking this option opens a text box ("Lainnya").
  freeTextMaxLength: z.number().int().positive().nullable(),
});

// A regency or district row opens its villages; a village row is picked.
const placeItemSchema = z.object({
  level: z.enum(["regency", "district", "village"]),
  code: z.string(),
  name: z.string(),
  districtName: z.string().nullable(),
  regencyName: z.string(),
  provinceName: z.string(),
});

export const placeResultsSchema = z.object({
  items: z.array(placeItemSchema),
  total: z.number().int().nonnegative(),
  cut: z.boolean(),
  dataDate: z.iso.date(),
});

// A summary row value; null when the field holds no value (none, not yet known, not known).
const rowValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("count"), count: z.number().int().positive() }),
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("options"), optionIds: z.array(z.string()), otherText: z.string().nullable() }),
  z.object({ kind: z.literal("hazardType"), hazardType: hazardTypeSchema }),
  z.object({ kind: z.literal("hazardSubtype"), hazardType: hazardTypeSchema, subtype: z.string() }),
  z.object({
    kind: z.literal("eventTime"),
    time: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("dateTime"), localDate: z.iso.date(), localTime: z.string(), zone: zoneSchema }),
      z.object({ kind: z.literal("dateOnly"), localDate: z.iso.date(), zone: zoneSchema }),
      z.object({ kind: z.literal("olderThan30Days") }),
    ]),
  }),
  z.object({
    kind: z.literal("place"),
    villageName: z.string(),
    districtName: z.string(),
    regencyName: z.string(),
    provinceName: z.string(),
    precision: z.literal("villageLevel"),
  }),
  z.object({ kind: z.literal("neighbourhood"), rt: z.string().nullable(), rw: z.string().nullable() }),
  z.object({
    kind: z.literal("chronology"),
    hazardType: hazardTypeSchema,
    steps: z.array(
      z.object({ step: z.number().int().positive(), optionIds: z.array(z.string()), otherText: z.string().nullable() }),
    ),
    note: z.string().nullable(),
    // The joined chronology as it is stored in the report.
    text: z.string(),
  }),
]);

const summaryGroupSchema = z.object({
  groupId: z.string(),
  rows: z.array(
    z.object({
      fieldId: z.string(),
      state: fieldStateSchema.exclude(["notAsked"]),
      value: rowValueSchema.nullable(),
      origin: valueOriginSchema.nullable(),
    }),
  ),
});

const base = {
  // Changes every revision, so an answer to an old card is recognised as stale.
  cardId: z.string(),
  titleKey: copyKeySchema,
  promptKey: copyKeySchema.nullable(),
  params: paramsSchema,
};

export const cardSchema = z.discriminatedUnion("kind", [
  z.object({
    ...base,
    kind: z.literal("placeSearch"),
    query: z.string().nullable(),
    places: placeResultsSchema.nullable(),
  }),
  z.object({
    ...base,
    kind: z.literal("regencyVillages"),
    // The regency or district whose villages are listed.
    areaCode: z.string(),
    areaLevel: z.enum(["regency", "district"]),
    query: z.string().nullable(),
    places: placeResultsSchema.nullable(),
  }),
  z.object({ ...base, kind: z.literal("neighbourhood"), fields: z.array(cardFieldSchema) }),
  z.object({ ...base, kind: z.literal("choice"), fieldId: z.string(), options: z.array(cardOptionSchema) }),
  z.object({ ...base, kind: z.literal("multiChoice"), fieldId: z.string(), options: z.array(cardOptionSchema) }),
  z.object({
    ...base,
    kind: z.literal("numberForm"),
    groupId: z.string(),
    fields: z.array(cardFieldSchema),
    formActions: z.array(z.enum(["allNone", "allUnknown"])),
  }),
  z.object({
    ...base,
    kind: z.literal("timeCard"),
    zone: zoneSchema,
    fields: z.array(cardFieldSchema),
    options: z.array(cardOptionSchema),
  }),
  z.object({ ...base, kind: z.literal("textQuestion"), fieldId: z.string(), fields: z.array(cardFieldSchema) }),
  z.object({
    ...base,
    kind: z.literal("chronologyStep"),
    hazardType: hazardTypeSchema,
    step: z.number().int().positive(),
    total: z.number().int().positive(),
    multiple: z.boolean(),
    options: z.array(cardOptionSchema),
  }),
  z.object({
    ...base,
    kind: z.literal("chronologyReview"),
    chronology: rowValueSchema,
    fields: z.array(cardFieldSchema),
  }),
  z.object({
    ...base,
    kind: z.literal("summary"),
    reporter: z.object({ name: z.string(), role: reporterRoleSchema }),
    groups: z.array(summaryGroupSchema),
  }),
  z.object({
    ...base,
    kind: z.literal("confirm"),
    confirmId: z.enum(["cancelDraft", "replaceDraft", "removeProfile", "declineConsent"]),
  }),
  z.object({ ...base, kind: z.literal("sent"), ticketNumber: z.string(), sentAt: timeSchema }),
  z.object({ ...base, kind: z.literal("cancelled") }),
]);

export type Card = z.infer<typeof cardSchema>;
