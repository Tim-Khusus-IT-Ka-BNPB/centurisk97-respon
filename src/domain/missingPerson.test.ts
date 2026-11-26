import { describe, expect, test } from "vitest";
import { MISSING_KEPT_MS, MISSING_PER_DAY, type MissingInput, mayMoveMissing, readMissing } from "./missingPerson";
import { DAY_MS } from "./time";

// 17:00 WIB on 26 November 2026.
const NOW = Date.UTC(2026, 10, 26, 10);

const FORM: MissingInput = {
  name: " Siti Aminah ",
  nickname: "",
  relation: "child",
  sex: "female",
  age: " 12 ",
  clothes: "Kaos merah",
  marks: "",
  lastSeenDate: "2026-11-25",
  lastSeenTime: "14:30",
  personNumber: "",
  contactNumber: "0812 3456 7890",
  waitPlace: " Posko Desa Sukamaju ",
};

const read = (change: Partial<MissingInput>) => readMissing({ ...FORM, ...change }, NOW, "WIB");
const refused = (change: Partial<MissingInput>) => {
  const answer = read(change);
  return Array.isArray(answer) ? answer.map((one) => one.rule) : [];
};

describe("a missing person as typed", () => {
  test("is read trimmed, with empty boxes as nothing", () => {
    expect(read({})).toEqual({
      name: "Siti Aminah",
      nickname: null,
      relation: "child",
      sex: "female",
      age: 12,
      clothes: "Kaos merah",
      marks: null,
      lastSeen: { date: "2026-11-25", time: "14:30" },
      personNumber: null,
      contactNumber: "+6281234567890",
      waitPlace: "Posko Desa Sukamaju",
    });
    expect(read({ lastSeenTime: " ", age: "", clothes: "   " })).toMatchObject({
      lastSeen: { date: "2026-11-25", time: null },
      age: null,
      clothes: null,
    });
    expect(read({ personNumber: " 0813 1111 2222 " })).toMatchObject({ personNumber: "+6281311112222" });
  });

  test("a name has no digits and 2 to 80 letters; a nickname the same as the name is not kept", () => {
    expect(refused({ name: "A" })).toEqual(["missing.name"]);
    expect(refused({ name: "Siti 2" })).toEqual(["missing.name"]);
    expect(refused({ name: "1Siti" })).toEqual(["missing.name"]);
    expect(refused({ name: "Siti1" })).toEqual(["missing.name"]);
    expect(refused({ name: "a".repeat(81) })).toEqual(["missing.name"]);
    expect(read({ name: "a".repeat(80) })).toMatchObject({ name: "a".repeat(80) });
    expect(read({ name: "Al" })).toMatchObject({ name: "Al" });
    expect(read({ nickname: " Ani " })).toMatchObject({ nickname: "Ani" });
    expect(read({ nickname: "SITI AMINAH" })).toMatchObject({ nickname: null });
    expect(read({ nickname: "siti aminah" })).toMatchObject({ nickname: null });
    expect(read({ nickname: "b".repeat(50) })).toMatchObject({ nickname: "b".repeat(40) });
    expect(refused({ nickname: "A1" })).toEqual(["missing.name"]);
  });

  test("relation and sex are one of the choices", () => {
    expect(refused({ relation: "cousin" })).toEqual(["missing.choose"]);
    expect(refused({ sex: "" })).toEqual(["missing.choose"]);
    expect(read({ relation: "other", sex: "unknown" })).toMatchObject({ relation: "other", sex: "unknown" });
  });

  test("an age is up to 120 in digits, or left out", () => {
    expect(read({ age: "0" })).toMatchObject({ age: 0 });
    expect(read({ age: "120" })).toMatchObject({ age: 120 });
    expect(refused({ age: "121" })).toEqual(["missing.age"]);
    expect(refused({ age: "1000" })).toEqual(["missing.age"]);
    expect(refused({ age: "dua" })).toEqual(["missing.age"]);
    expect(refused({ age: "1.5" })).toEqual(["missing.age"]);
  });

  test("the last seen day is a real date, not ahead of today and not more than a year back", () => {
    expect(read({ lastSeenDate: "2026-11-26", lastSeenTime: "" })).toMatchObject({ lastSeen: { date: "2026-11-26" } });
    expect(read({ lastSeenDate: " 2025-11-25 " })).toMatchObject({ lastSeen: { date: "2025-11-25" } });
    expect(refused({ lastSeenDate: "2025-11-24" })).toEqual(["missing.tooOld"]);
    expect(refused({ lastSeenDate: "2026-11-27" })).toEqual(["missing.future"]);
    expect(refused({ lastSeenDate: "2026-02-30" })).toEqual(["missing.date"]);
    expect(refused({ lastSeenDate: "25-11-2026" })).toEqual(["missing.date"]);
    expect(refused({ lastSeenDate: "" })).toEqual(["missing.date"]);
  });

  test("the time is HH:MM, and today no later than ten minutes from now", () => {
    for (const time of ["00:00", "09:05", "19:59", "20:00", "23:59"])
      expect(read({ lastSeenTime: time })).toMatchObject({ lastSeen: { time } });
    for (const time of ["24:00", "14:60", "9:30", "1430", "x14:30", "114:30", "14:30x", "14:301", "1a:30", "14:3a"])
      expect(refused({ lastSeenTime: time }), time).toEqual(["missing.time"]);
    expect(read({ lastSeenDate: "2026-11-26", lastSeenTime: "17:10" })).toMatchObject({ lastSeen: { time: "17:10" } });
    expect(refused({ lastSeenDate: "2026-11-26", lastSeenTime: "17:11" })).toEqual(["missing.future"]);
    // A bad date with a time is refused for its date alone.
    expect(refused({ lastSeenDate: "2026-11-27", lastSeenTime: "08:00" })).toEqual(["missing.future"]);
  });

  test("numbers are Indonesian numbers; the place to wait is 5 to 200 letters", () => {
    expect(refused({ personNumber: "0812" })).toEqual(["missing.number"]);
    expect(refused({ contactNumber: "" })).toEqual(["missing.number"]);
    expect(refused({ waitPlace: " Pos " })).toEqual(["missing.waitPlace"]);
    expect(read({ waitPlace: "Posko" })).toMatchObject({ waitPlace: "Posko" });
    expect(read({ waitPlace: "p".repeat(200) })).toMatchObject({ waitPlace: "p".repeat(200) });
    expect(refused({ waitPlace: "p".repeat(201) })).toEqual(["missing.waitPlace"]);
    expect(read({ clothes: "c".repeat(130), marks: " Tahi lalat di pipi " })).toMatchObject({
      clothes: "c".repeat(120),
      marks: "Tahi lalat di pipi",
    });
    expect(read({ marks: "m".repeat(130) })).toMatchObject({ marks: "m".repeat(120) });
  });

  test("every refused field is named, in the order of the form", () => {
    expect(
      readMissing(
        {
          ...FORM,
          name: "",
          nickname: "9",
          relation: "",
          sex: "",
          age: "x",
          lastSeenDate: "",
          lastSeenTime: "x",
          personNumber: "1",
          contactNumber: "1",
          waitPlace: "",
        },
        NOW,
        "WIB",
      ),
    ).toEqual([
      { field: "name", rule: "missing.name" },
      { field: "nickname", rule: "missing.name" },
      { field: "relation", rule: "missing.choose" },
      { field: "sex", rule: "missing.choose" },
      { field: "age", rule: "missing.age" },
      { field: "lastSeenDate", rule: "missing.date" },
      { field: "lastSeenTime", rule: "missing.time" },
      { field: "personNumber", rule: "missing.number" },
      { field: "contactNumber", rule: "missing.number" },
      { field: "waitPlace", rule: "missing.waitPlace" },
    ]);
  });

  test("the day is the place's own: 07:30 WIT is still the 26th when UTC says the 25th", () => {
    const early = Date.UTC(2026, 10, 25, 22, 30);
    expect(readMissing({ ...FORM, lastSeenDate: "2026-11-26", lastSeenTime: "07:30" }, early, "WIT")).toMatchObject({
      lastSeen: { date: "2026-11-26" },
    });
  });
});

describe("what an officer may do with a missing person", () => {
  test("an open one moves to any outcome; an outcome only back to open", () => {
    expect(mayMoveMissing("open", "foundSafe")).toBe(true);
    expect(mayMoveMissing("open", "closed")).toBe(true);
    expect(mayMoveMissing("foundDead", "open")).toBe(true);
    expect(mayMoveMissing("open", "open")).toBe(false);
    expect(mayMoveMissing("foundSafe", "closed")).toBe(false);
    expect(mayMoveMissing("toSar", "toSar")).toBe(false);
  });

  test("five a day per number, kept two years once closed", () => {
    expect(MISSING_PER_DAY).toBe(5);
    expect(MISSING_KEPT_MS).toBe(730 * DAY_MS);
  });
});
