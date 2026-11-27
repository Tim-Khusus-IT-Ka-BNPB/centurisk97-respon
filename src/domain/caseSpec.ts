import { normaliseNumber } from "./phoneNumber";

// The BPBD's follow-up data after a first report (upstream "Data lanjutan BPBD", M09: K2, D3, D4,
// D19, ALGORITMA 2): seven kinds of record, each with its general values and, kept apart, the
// personal ones (names, numbers, NIK, health) that only the team reads in full.

export const CASE_KINDS = ["house", "infrastructure", "shelter", "evacuee", "victim", "business", "need"] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

export const DAMAGE = ["heavy", "moderate", "light"] as const;
// Infrastructure reaching the desk's vital-service and basic-service columns (upstream VITAL, LAYANAN).
export const VITAL = ["power", "water", "signal", "irrigation", "transport", "fuelStation"] as const;
export const SERVICES = ["school", "healthFacility", "worship", "office", "market"] as const;
const INFRASTRUCTURE = ["bridge", "road", ...SERVICES, ...VITAL, "other"] as const;
// A face photo is asked from this age (Q13, the child limit of UU 35/2014).
const ADULT_AGE = 18;
const VULNERABLE = [
  "toddler",
  "pregnant1",
  "pregnant2",
  "pregnant3",
  "breastfeeding",
  "elderly",
  "physicalDisability",
  "sensoryDisability",
  "intellectualDisability",
  "mentalDisability",
  "sick",
] as const;
const SHELTER_SECTORS = [
  "needWater",
  "needFood",
  "needClothing",
  "needHealth",
  "needHousing",
  "needEducation",
] as const;

type FieldType =
  | { readonly type: "choice"; readonly values: readonly string[] }
  | { readonly type: "text"; readonly max: number }
  | { readonly type: "number"; readonly min: number; readonly max: number; readonly decimal: boolean }
  | { readonly type: "date" }
  | { readonly type: "yesNo" }
  | { readonly type: "phone" }
  | { readonly type: "nik" }
  | { readonly type: "many"; readonly values: readonly string[] }
  // Another record of the same file, by its id: an evacuee's shelter or head of family.
  | { readonly type: "record" };

type Values = Readonly<Record<string, unknown>>;
export type CaseField = {
  readonly id: string;
  readonly field: FieldType;
  // Always, never, or by the values given so far.
  readonly required: boolean | ((values: Values) => boolean);
  readonly personal: boolean;
};

const choice = (...values: string[]): FieldType => ({ type: "choice", values });
const text = (max = 120): FieldType => ({ type: "text", max });
const count = (min: number, max: number, decimal = false): FieldType => ({ type: "number", min, max, decimal });
const DATE: FieldType = { type: "date" };
const YES_NO: FieldType = { type: "yesNo" };
const RECORD: FieldType = { type: "record" };
const field = (id: string, type: FieldType, required: CaseField["required"], personal = false): CaseField => ({
  id,
  field: type,
  required,
  personal,
});
const roadOrBridge = (values: Values) => values.type === "road" || values.type === "bridge";

export const CASE_SPEC: Readonly<Record<CaseKind, { readonly photos: number; readonly fields: readonly CaseField[] }>> =
  {
    house: {
      photos: 2,
      fields: [
        field("headOfFamily", text(), true, true),
        field("owner", text(), false, true),
        field("familyNik", { type: "nik" }, false, true),
        field("village", text(), true),
        field("district", text(), true),
        field("address", text(200), true),
        field("damage", choice(...DAMAGE, "none"), true),
        field("flooded", YES_NO, true),
        field("occupancy", choice("occupied", "displaced", "flattened", "unknown"), true),
        field("people", count(0, 100), true),
        field("note", text(400), false),
      ],
    },
    infrastructure: {
      photos: 2,
      fields: [
        field("type", choice(...INFRASTRUCTURE), true),
        field("name", text(), true),
        field("village", text(), true),
        field("damage", choice(...DAMAGE), true),
        field("function", choice("cut", "limited", "working"), true),
        field("lengthM", count(0, 1_000_000, true), roadOrBridge),
        field("vehicles", choice("none", "motorcycle", "car", "truck", "unknown"), roadOrBridge),
        field("alternative", text(200), false),
      ],
    },
    shelter: {
      photos: 1,
      fields: [
        field("name", text(), true),
        field("village", text(), true),
        field("placeKind", choice("concentrated", "dispersed"), true),
        field("placeType", choice("publicFacility", "openField", "privateBuilding", "worship", "privateHome"), true),
        field("openedOn", DATE, true),
        ...SHELTER_SECTORS.map((id) => field(id, YES_NO, true)),
        field("toilets", YES_NO, false),
        field("kitchen", YES_NO, false),
        field("power", YES_NO, false),
        field("capacity", count(0, 100_000), false),
      ],
    },
    evacuee: {
      photos: 0,
      fields: [
        field("shelter", RECORD, true),
        field("name", text(), true, true),
        field("age", count(0, 120), true),
        field("sex", choice("male", "female"), true),
        field("homeVillage", text(), true),
        field("entered", DATE, true),
        // "self", or the id of the head of family's own record in this file.
        field("head", text(16), true),
        field("phone", { type: "phone" }, (values) => values.head === "self", true),
        field("nik", { type: "nik" }, false, true),
        field("vulnerable", { type: "many", values: VULNERABLE }, false, true),
        field("specialNeeds", text(300), false, true),
        field("refusesPhoto", YES_NO, false),
        field("left", DATE, false),
      ],
    },
    victim: {
      photos: 0,
      fields: [
        field("status", choice("dead", "missing", "badlyHurt", "lightlyHurt"), true),
        field("name", text(), true, true),
        field("age", count(0, 120), true),
        field("sex", choice("male", "female"), true),
        field("village", text(), true),
        field("contactName", text(), true, true),
        field("contactPhone", { type: "phone" }, true, true),
        field("lastSeenPlace", text(200), (values) => values.status === "missing"),
        field("lastSeenOn", DATE, (values) => values.status === "missing"),
        field("search", choice("searching", "foundAlive", "foundDead"), (values) => values.status === "missing"),
        field("treatedAt", text(), false),
        field("deathPlace", text(), false),
        field("confirmedBy", choice("hospital", "family", "officials"), false),
        field("traits", text(300), false, true),
        field("nik", { type: "nik" }, false, true),
      ],
    },
    business: {
      photos: 1,
      fields: [
        field("type", choice("rice", "plantation", "pond", "livestock", "shop", "other"), true),
        field("village", text(), true),
        field("amount", count(0, 10_000_000, true), true),
        field("unit", choice("hectare", "head", "unit"), true),
      ],
    },
    need: {
      photos: 0,
      fields: [
        field("shelter", RECORD, false),
        field("village", text(), (values) => values.shelter === undefined),
        field("item", choice("logistics", "water", "medicine", "tents", "heavyEquipment", "other"), true),
        field("amount", count(0, 10_000_000, true), true),
        field("unit", text(30), true),
        field("urgent", YES_NO, true),
        field("aidFrom", text(), false),
        field("aidWhat", text(200), false),
        field("aidAmount", count(0, 10_000_000, true), false),
      ],
    },
  };

// A day written as YYYY-MM-DD that exists: anything else reads back as another text, or not at all.
const isDate = (value: unknown): value is string => {
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
};

// One value read as its field allows, or undefined when it does not fit.
function readValue(value: unknown, type: FieldType): unknown {
  switch (type.type) {
    case "choice":
      return type.values.includes(value as string) ? value : undefined;
    case "text": {
      if (typeof value !== "string" && typeof value !== "number") return undefined;
      const tidy = String(value).trim().replace(/\s+/g, " ");
      return tidy.length > type.max ? undefined : tidy;
    }
    case "number": {
      const n = Number(String(value).replace(",", "."));
      const fits = Number.isFinite(n) && n >= type.min && n <= type.max && (type.decimal || Number.isInteger(n));
      return fits ? n : undefined;
    }
    case "date":
      return isDate(value) ? value : undefined;
    case "yesNo":
      return typeof value === "boolean" ? value : undefined;
    case "phone":
      return value === "none" ? value : (normaliseNumber(String(value)) ?? undefined);
    case "nik": {
      const digits = String(value).replace(/\D/g, "");
      return digits.length === 16 ? digits : undefined;
    }
    case "many":
      return Array.isArray(value) && value.every((one) => type.values.includes(one)) ? [...new Set(value)] : undefined;
    case "record":
      return typeof value === "string" && /^[0-9a-f]{16}$/.test(value) ? value : undefined;
  }
}

export type CaseValues = Readonly<Record<string, unknown>>;
export type CheckedRecord = {
  // The fields that are missing or do not fit, in the order of the form.
  readonly errors: readonly string[];
  readonly data: CaseValues;
  readonly personal: CaseValues;
};

// A record's values checked against its kind: what does not fit is named, what is unknown dropped,
// and an empty value stays empty, never 0.
export function checkRecord(kind: CaseKind, typed: CaseValues): CheckedRecord {
  const data: Record<string, unknown> = {};
  const personal: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const one of CASE_SPEC[kind].fields) {
    const value = typed[one.id];
    if (value === undefined || value === null || value === "") continue;
    const read = readValue(value, one.field);
    if (read === undefined || read === "") errors.push(one.id);
    else (one.personal ? personal : data)[one.id] = read;
  }
  const given = { ...data, ...personal };
  for (const one of CASE_SPEC[kind].fields) {
    const needed = typeof one.required === "function" ? one.required(given) : one.required;
    if (needed && given[one.id] === undefined && !errors.includes(one.id)) errors.push(one.id);
  }
  // Only an evacuee has these; a missing day compares as false.
  if ((data.left as string) < (data.entered as string)) errors.push("left");
  return { errors, data, personal };
}

// A face photo, only of an adult evacuee who has not refused, or of a victim still searched for
// (Q8, Q10, Q13). When that stops holding, the face goes.
export const faceAllowed = (kind: CaseKind, data: CaseValues): boolean =>
  kind === "evacuee"
    ? (data.age as number) >= ADULT_AGE && data.refusesPhoto !== true
    : kind === "victim" && data.status === "missing" && data.search === "searching";

// The photos a record still needs: its kind's number, and an adult evacuee's face (Q12, Q13).
export function photosMissing(
  kind: CaseKind,
  data: CaseValues,
  media: readonly { readonly kind: "photo" | "face" | "video" }[],
): { readonly photo: number; readonly face: number } {
  const has = (wanted: "photo" | "face") => media.filter((one) => one.kind === wanted).length;
  const face = kind === "evacuee" && faceAllowed(kind, data) ? 1 : 0;
  return { photo: Math.max(0, CASE_SPEC[kind].photos - has("photo")), face: Math.max(0, face - has("face")) };
}

// The file's own values (F-9): its emergency status, decree, post, efforts and personnel.
const EMERGENCY_STATUSES = ["alert", "emergencyResponse", "transition", "notSet"] as const;
const FILE_FIELDS = ["emergencyStatus", "decreeNumber", "decreeDate", "post", "efforts", "personnel"] as const;
const POST_FIELDS = ["name", "shelter", "phone"] as const;

const tidyText = (value: unknown, max: number) => {
  if (typeof value !== "string") return undefined;
  const tidy = value.trim().replace(/\s+/g, " ");
  return tidy !== "" && tidy.length <= max ? tidy : undefined;
};

export type CheckedFileFields = {
  readonly errors: readonly string[];
  readonly patch: Readonly<Record<string, unknown>>;
};

// A change to the file's values as a merge patch: null clears one. The decree is not dated after
// today; a post needs its name.
export function checkFileFields(typed: unknown, today: string, postNamed: boolean): CheckedFileFields {
  if (typeof typed !== "object" || typed === null || Array.isArray(typed)) return { errors: ["fields"], patch: {} };
  const patch: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [id, value] of Object.entries(typed)) {
    if (!FILE_FIELDS.some((one) => one === id)) {
      errors.push(id);
      continue;
    }
    if (value === null || value === "") {
      patch[id] = null;
      continue;
    }
    const read =
      id === "emergencyStatus"
        ? EMERGENCY_STATUSES.find((one) => one === value)
        : id === "decreeNumber"
          ? tidyText(value, 60)
          : id === "decreeDate"
            ? isDate(value) && value <= today
              ? value
              : undefined
            : id === "efforts"
              ? tidyText(value, 500)
              : id === "personnel"
                ? Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100_000
                  ? value
                  : undefined
                : checkPost(value, postNamed);
    if (read === undefined) errors.push(id);
    else patch[id] = read;
  }
  return { errors, patch };
}

function checkPost(value: unknown, named: boolean): Readonly<Record<string, unknown>> | undefined {
  // A text or a list has no post fields: its entries are refused below.
  const entries = Object.entries(value as object);
  const post: Record<string, unknown> = {};
  for (const [id, one] of entries) {
    if (!POST_FIELDS.some((known) => known === id)) return undefined;
    const read =
      one === null || one === ""
        ? null
        : id === "name"
          ? tidyText(one, 120)
          : id === "shelter"
            ? readValue(one, RECORD)
            : /^\+?\d{6,15}$/.test(String(one).replace(/[\s().-]/g, ""))
              ? String(one).replace(/[\s().-]/g, "")
              : undefined;
    if (read === undefined) return undefined;
    post[id] = read;
  }
  // With no name given, any other value needs the name kept from before.
  const others = Object.values(post).some((one) => one !== null);
  if (entries.length === 0 || post.name === null || (post.name === undefined && !named && others)) return undefined;
  return post;
}

// What BNPB's desk sees of a personal value until it asks for it in full (Q6): each word's first
// letter, the last four digits of a number or NIK, and a list by its length.
const maskOne = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(() => "***");
  const text = String(value);
  if (text === "none") return text;
  if (/^\+?\d{6,}$/.test(text)) return `${"*".repeat(text.length - 4)}${text.slice(-4)}`;
  return text
    .split(" ")
    .map((word) => `${word.charAt(0)}***`)
    .join(" ");
};

export const maskPersonal = (values: CaseValues): CaseValues =>
  Object.fromEntries(Object.entries(values).map(([id, value]) => [id, maskOne(value)]));
