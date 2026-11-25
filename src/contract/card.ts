import { z } from "zod";
import { VICTIM_ANSWERS } from "../domain/emergency";
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
import { trackingSchema } from "./tracking";

export const CARD_KINDS = [
  "placeSearch",
  "regencyVillages",
  "placeConfirm",
  "neighbourhood",
  "choice",
  "multiChoice",
  "numberForm",
  "timeCard",
  "textQuestion",
  "chronologyStep",
  "chronologyReview",
  "photos",
  "summary",
  "confirm",
  "sent",
  "cancelled",
  "followUpEnded",
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

const placePrecisionSchema = z.enum(["villageLevel", "gpsPoint", "estimate"]);
// The device's reading; coordinates as read, accuracy in metres.
const placePointSchema = z.object({ lat: z.number(), lon: z.number(), accuracyM: z.number() });
const readVillageSchema = z.object({
  code: z.string(),
  villageName: z.string(),
  districtName: z.string(),
  regencyName: z.string(),
  provinceName: z.string(),
});

const photoSchema = z.object({
  photoId: z.string(),
  badge: z.enum(["deviceGps", "photoData", "none"]),
  // More than 10 km from the report's place (A4).
  far: z.boolean(),
  takenAt: timeSchema,
  timeSource: z.enum(["photoData", "deviceGps", "upload"]),
  point: z.object({ lat: z.number(), lon: z.number() }).nullable(),
  accuracyM: z.number().nullable(),
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
    precision: placePrecisionSchema,
    point: placePointSchema.nullable(),
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

export const summaryGroupSchema = z.object({
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

// A value that says something else than before; one never reached is null.
export const valueChangeSchema = z.object({
  fieldId: z.string(),
  from: summaryGroupSchema.shape.rows.element.nullable(),
  to: summaryGroupSchema.shape.rows.element.nullable(),
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
  z.object({
    ...base,
    kind: z.literal("placeConfirm"),
    village: readVillageSchema,
    point: placePointSchema,
    precision: placePrecisionSchema.exclude(["villageLevel"]),
    // "Benar" and "Bukan, pilih desa/kelurahan lain".
    options: z.array(cardOptionSchema),
    // The nearest villages, listed once "Bukan" is tapped.
    nearby: z.array(readVillageSchema.extend({ km: z.number() })).nullable(),
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
    kind: z.literal("photos"),
    photos: z.array(photoSchema),
    max: z.number().int().positive(),
    // "Lanjut" once a photo is kept, "Tidak bisa mengirim foto" before.
    options: z.array(cardOptionSchema),
  }),
  z.object({
    ...base,
    kind: z.literal("summary"),
    reporter: z.object({ name: z.string(), role: reporterRoleSchema }),
    // An emergency, with what the reporter said of victims; absent in a body from before it existed.
    emergency: z
      .object({ victims: z.enum(VICTIM_ANSWERS).nullable() })
      .nullable()
      .optional(),
    groups: z.array(summaryGroupSchema),
    photos: z.object({ count: z.number().int().nonnegative(), withPlace: z.number().int().nonnegative() }),
    // News for a sent report: which one, what it would change, and whether it may add photos.
    followUp: z
      .object({
        ticketNumber: z.string(),
        // The report's hazard, which words some labels; null while it is not known.
        hazardType: hazardTypeSchema.nullable(),
        changes: z.array(valueChangeSchema),
        mayAddPhotos: z.boolean(),
      })
      .nullable()
      .optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("confirm"),
    confirmId: z.enum(["cancelDraft", "cancelFollowUp", "replaceDraft", "removeProfile", "declineConsent"]),
  }),
  z.object({
    ...base,
    kind: z.literal("sent"),
    ticketNumber: z.string(),
    sentAt: timeSchema,
    // Shown on the thank-you screen; the reporter's own name, to its owner only.
    firstName: z.string(),
    // null until the reporter rates; the thank-you screen shows until then (K81).
    rating: z.number().int().min(1).max(5).nullable(),
    // The secret of the tracking link, which travels in the link's fragment.
    trackingToken: z.string(),
    tracking: trackingSchema,
  }),
  z.object({ ...base, kind: z.literal("cancelled") }),
  // News for a sent report that is sent or dropped; the report itself is as it was.
  z.object({
    ...base,
    kind: z.literal("followUpEnded"),
    ticketNumber: z.string(),
    outcome: z.enum(["sent", "cancelled"]),
  }),
]);

export type Card = z.infer<typeof cardSchema>;
