import { localClock, localDate, validDate, type Zone } from "./eventTime";
import { normaliseNumber } from "./phoneNumber";
import { DAY_MS, MINUTE_MS } from "./time";

// A person not yet found (upstream K105, LA-80, LA-82): a report of its own, never a ticket, seen
// only by BNPB and the BPBD of its region. Names and numbers are personal data.

export const RELATIONS = ["child", "parent", "spouse", "sibling", "friend", "other"] as const;
export const SEXES = ["male", "female", "unknown"] as const;
export const MISSING_STATUSES = ["open", "foundSafe", "foundDead", "toSar", "closed"] as const;
export type MissingStatus = (typeof MISSING_STATUSES)[number];

export type MissingInput = {
  readonly name: string;
  readonly nickname: string;
  readonly relation: string;
  readonly sex: string;
  readonly age: string;
  readonly clothes: string;
  readonly marks: string;
  readonly lastSeenDate: string;
  readonly lastSeenTime: string;
  readonly personNumber: string;
  readonly contactNumber: string;
  readonly waitPlace: string;
};

export type MissingPerson = {
  readonly name: string;
  readonly nickname: string | null;
  readonly relation: (typeof RELATIONS)[number];
  readonly sex: (typeof SEXES)[number];
  readonly age: number | null;
  readonly clothes: string | null;
  readonly marks: string | null;
  readonly lastSeen: { readonly date: string; readonly time: string | null };
  readonly personNumber: string | null;
  readonly contactNumber: string;
  readonly waitPlace: string;
};

export type MissingError = { readonly field: keyof MissingInput; readonly rule: string };

const NAME = /^[^\d]{2,80}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = (value: string, max: number) => (value.trim() === "" ? null : value.trim().slice(0, max));

// The form as typed, read into a report, or every field it refuses. The last seen moment is in the
// zone of the place: not ahead of now, and no more than a year ago.
export function readMissing(input: MissingInput, nowMs: number, zone: Zone): MissingPerson | readonly MissingError[] {
  const errors: MissingError[] = [];
  const refuse = (field: keyof MissingInput, rule: string) => errors.push({ field, rule });
  const name = input.name.trim();
  if (!NAME.test(name)) refuse("name", "missing.name");
  const nickname = text(input.nickname, 40);
  if (nickname?.match(NAME) === null) refuse("nickname", "missing.name");
  const relation = RELATIONS.find((one) => one === input.relation);
  if (relation === undefined) refuse("relation", "missing.choose");
  const sex = SEXES.find((one) => one === input.sex);
  if (sex === undefined) refuse("sex", "missing.choose");
  const ageText = input.age.trim();
  const age = ageText === "" ? null : Number(ageText);
  if (age !== null && !(/^\d{1,3}$/.test(ageText) && age <= 120)) refuse("age", "missing.age");
  const today = localDate(nowMs, zone);
  const yearAgo = localDate(nowMs - 366 * DAY_MS, zone);
  const date = input.lastSeenDate.trim();
  if (!validDate(date)) refuse("lastSeenDate", "missing.date");
  else if (date > today) refuse("lastSeenDate", "missing.future");
  else if (date < yearAgo) refuse("lastSeenDate", "missing.tooOld");
  const time = input.lastSeenTime.trim() === "" ? null : input.lastSeenTime.trim();
  if (time !== null && !TIME.test(time)) refuse("lastSeenTime", "missing.time");
  else if (date === today && (time ?? "") > localClock(nowMs + 10 * MINUTE_MS, zone))
    refuse("lastSeenTime", "missing.future");
  const personNumber = normaliseNumber(input.personNumber);
  if (personNumber === null && input.personNumber.trim() !== "") refuse("personNumber", "missing.number");
  const contactNumber = normaliseNumber(input.contactNumber);
  if (contactNumber === null) refuse("contactNumber", "missing.number");
  const waitPlace = input.waitPlace.trim();
  if (waitPlace.length < 5 || waitPlace.length > 200) refuse("waitPlace", "missing.waitPlace");
  if (errors.length > 0) return errors;
  return {
    name,
    nickname: nickname !== null && nickname.toLowerCase() !== name.toLowerCase() ? nickname : null,
    relation: relation as MissingPerson["relation"],
    sex: sex as MissingPerson["sex"],
    age,
    clothes: text(input.clothes, 120),
    marks: text(input.marks, 120),
    lastSeen: { date, time },
    personNumber,
    contactNumber: contactNumber as string,
    waitPlace,
  };
}

// A status an officer may move to from this one: an open report to any outcome, a closed one only
// back open (reopened); the same status twice is no move.
export const mayMoveMissing = (from: MissingStatus, to: MissingStatus): boolean =>
  from !== to && (from === "open" || to === "open");

// How many a number may report in a day (upstream: 5).
export const MISSING_PER_DAY = 5;
// Its one photo may be an old one from the gallery, so it may be larger than a fresh camera photo.
export const MISSING_PHOTO_BYTES = 5 * 1024 * 1024;
// Closed this long ago, a report keeps no name, number or photo (upstream Q67).
export const MISSING_KEPT_MS = 2 * 365 * DAY_MS;
