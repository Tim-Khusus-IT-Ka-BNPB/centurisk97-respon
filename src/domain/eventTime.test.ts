import { describe, expect, test } from "vitest";
import { checkEventTime, localDate, parseEventTimeText, provinceZone, zoneOffsetMs } from "./eventTime";

// 14.30 WIB on 19 November 2026.
const now = Date.UTC(2026, 10, 19, 7, 30);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe("zone of a province", () => {
  test("WITA and WIT provinces, WIB otherwise and before a place", () => {
    for (const code of ["51", "52", "53", "63", "64", "65", "71", "72", "73", "74", "75", "76"]) {
      expect(provinceZone(code)).toBe("WITA");
    }
    for (const code of ["81", "82", "91", "92", "93", "94", "95", "96"]) expect(provinceZone(code)).toBe("WIT");
    expect(provinceZone("31")).toBe("WIB");
    expect(provinceZone(null)).toBe("WIB");
  });

  test("offsets and local dates", () => {
    expect([zoneOffsetMs("WIB"), zoneOffsetMs("WITA"), zoneOffsetMs("WIT")]).toEqual(
      [7, 8, 9].map((h) => h * 3_600_000),
    );
    const lateEvening = Date.UTC(2026, 10, 19, 15, 30);
    expect(localDate(lateEvening, "WIB")).toBe("2026-11-19");
    expect(localDate(lateEvening, "WIT")).toBe("2026-11-20");
  });
});

describe("event time from the time card", () => {
  const at = (ms: number, zone: "WIB" | "WIT" = "WIB") => {
    const local = new Date(ms + zoneOffsetMs(zone)).toISOString();
    return { kind: "dateTime", localDate: local.slice(0, 10), localTime: local.slice(11, 16), zone } as const;
  };

  test("exactly 10 minutes ahead and exactly 30 days back pass", () => {
    expect(checkEventTime(at(now + 10 * MINUTE), now)).toBeNull();
    expect(checkEventTime(at(now - 30 * DAY), now)).toBeNull();
  });

  test("11 minutes ahead and 30 days and 1 minute back are refused", () => {
    expect(checkEventTime(at(now + 11 * MINUTE), now)).toBe("inFuture");
    expect(checkEventTime(at(now - 30 * DAY - MINUTE), now)).toBe("tooOld");
  });

  test("the hour is read in the zone of the place", () => {
    const elevenAhead = { kind: "dateTime", localDate: "2026-11-19", localTime: "16:41", zone: "WIT" } as const;
    expect(checkEventTime(elevenAhead, now)).toBe("inFuture");
    expect(checkEventTime({ ...elevenAhead, localTime: "16:40" }, now)).toBeNull();
    expect(checkEventTime(at(now, "WIT"), now)).toBeNull();
  });

  test("a date with no hour passes from today back to the date 30 days ago", () => {
    expect(checkEventTime({ kind: "dateOnly", localDate: "2026-11-19", zone: "WIB" }, now)).toBeNull();
    expect(checkEventTime({ kind: "dateOnly", localDate: "2026-10-20", zone: "WIB" }, now)).toBeNull();
    expect(checkEventTime({ kind: "dateOnly", localDate: "2026-11-20", zone: "WIB" }, now)).toBe("inFuture");
    expect(checkEventTime({ kind: "dateOnly", localDate: "2026-10-19", zone: "WIB" }, now)).toBe("tooOld");
  });

  test("tomorrow is allowed once 10 minutes before local midnight", () => {
    const nearMidnight = Date.UTC(2026, 10, 19, 16, 50);
    expect(checkEventTime({ kind: "dateOnly", localDate: "2026-11-20", zone: "WIB" }, nearMidnight)).toBeNull();
    expect(checkEventTime({ kind: "dateOnly", localDate: "2026-11-20", zone: "WIB" }, nearMidnight - MINUTE)).toBe(
      "inFuture",
    );
  });

  test("older than 30 days is a choice of its own", () => {
    expect(checkEventTime({ kind: "olderThan30Days" }, now)).toBeNull();
  });

  test("impossible dates and hours are refused", () => {
    for (const localDate of ["2026-02-30", "2026-13-01", "2026-11-1", "19-11-2026", "2026-11-00"]) {
      expect(checkEventTime({ kind: "dateOnly", localDate, zone: "WIB" }, now)).toBe("dateFormat");
    }
    for (const localDate of ["0050-01-01", "abc", "2026-11-19x", "x2026-11-19"]) {
      expect(checkEventTime({ kind: "dateOnly", localDate, zone: "WIB" }, now)).toBe("dateFormat");
    }
    expect(checkEventTime({ kind: "dateOnly", localDate: "2025-12-31", zone: "WIB" }, now)).toBe("tooOld");
    for (const localTime of ["24:00", "10:60", "9:00", "1000", "x10:00", "10:00x"]) {
      expect(checkEventTime({ kind: "dateTime", localDate: "2026-11-19", localTime, zone: "WIB" }, now)).toBe(
        "hourFormat",
      );
    }
    expect(checkEventTime({ kind: "dateTime", localDate: "2026-11-19", localTime: "23:59", zone: "WIB" }, now)).toBe(
      "inFuture",
    );
    expect(
      checkEventTime({ kind: "dateTime", localDate: "2026-11-19", localTime: "00:00", zone: "WIB" }, now),
    ).toBeNull();
  });
});

describe("event time from typed words", () => {
  const value = (text: string, zone: "WIB" | "WITA" = "WIB", at = now) => parseEventTimeText(text, at, zone);

  test("ported vectors", () => {
    expect(value("tadi malam jam 21.00")).toEqual({
      value: { kind: "dateTime", localDate: "2026-11-18", localTime: "21:00", zone: "WIB" },
    });
    expect(value("19 November 2026 jam 9 pagi")).toEqual({
      value: { kind: "dateTime", localDate: "2026-11-19", localTime: "09:00", zone: "WIB" },
    });
    expect(value("hari ini jam 22.00")).toEqual({ error: "inFuture" });
    expect(value("19/11/2026 10.15", "WITA")).toEqual({
      value: { kind: "dateTime", localDate: "2026-11-19", localTime: "10:15", zone: "WITA" },
    });
  });

  test("a date with no hour is kept as a date only, never guessed", () => {
    expect(value("hari ini")).toEqual({ value: { kind: "dateOnly", localDate: "2026-11-19", zone: "WIB" } });
  });

  test("an hour with no date asks for the date", () => {
    expect(value("jam 3 sore")).toEqual({ error: "dateRequired" });
    expect(value("")).toEqual({ error: "dateRequired" });
  });

  test("relative days", () => {
    const date = (text: string, at = now) => {
      const parsed = value(text, "WIB", at);
      return "value" in parsed && parsed.value.kind !== "olderThan30Days" ? parsed.value.localDate : parsed;
    };
    expect(date("kemarin")).toBe("2026-11-18");
    expect(date("kemarin lusa")).toBe("2026-11-17");
    expect(date("semalam")).toBe("2026-11-18");
    expect(date("tadi malam", Date.UTC(2026, 10, 19, 11, 0))).toBe("2026-11-19");
    expect(date("tadi malam", Date.UTC(2026, 10, 19, 10, 59))).toBe("2026-11-18");
    for (const word of ["tadi", "barusan", "sekarang", "baru saja"]) expect(date(word)).toBe("2026-11-19");
  });

  test("written and numeric dates", () => {
    const dateOf = (text: string) => {
      const parsed = value(text, "WIB", Date.UTC(2026, 11, 30, 5, 0));
      return "value" in parsed && parsed.value.kind === "dateOnly" ? parsed.value.localDate : parsed;
    };
    expect(dateOf("3 des 2026")).toBe("2026-12-03");
    expect(dateOf("1 Desember 2026")).toBe("2026-12-01");
    expect(dateOf("03-12-26")).toBe("2026-12-03");
    expect(dateOf("3.12.2026")).toBe("2026-12-03");
    expect(dateOf("1 Desmber 2026")).toBe("2026-12-01");
    expect(dateOf("3 xyz 2026")).toEqual({ error: "dateRequired" });
    expect(dateOf("3/12/100")).toEqual({ error: "dateFormat" });
    expect(dateOf("30 Januari 2026")).toEqual({ error: "tooOld" });
  });

  test("clock words turn morning numbers into afternoon and evening", () => {
    const timeOf = (text: string) => {
      const parsed = value(`kemarin ${text}`);
      return "value" in parsed && parsed.value.kind === "dateTime" ? parsed.value.localTime : parsed;
    };
    expect(timeOf("jam 1 siang")).toBe("13:00");
    expect(timeOf("jam 6 siang")).toBe("06:00");
    expect(timeOf("jam 4 sore")).toBe("16:00");
    expect(timeOf("pukul 12 sore")).toBe("12:00");
    expect(timeOf("pkl 7 malam")).toBe("19:00");
    expect(timeOf("jam 5 malam")).toBe("05:00");
    expect(timeOf("jam 6 malam")).toBe("18:00");
    expect(timeOf("jam9")).toBe("09:00");
    expect(timeOf("jam 12 malam")).toBe("12:00");
    expect(timeOf("08:45")).toBe("08:45");
    expect(timeOf("jam 123")).toEqual({ value: { kind: "dateOnly", localDate: "2026-11-18", zone: "WIB" } });
    expect(timeOf("jam 25")).toEqual({ error: "hourFormat" });
  });

  test("every month name is read", () => {
    const months = [
      "januari",
      "februari",
      "maret",
      "april",
      "mei",
      "juni",
      "juli",
      "agustus",
      "september",
      "oktober",
      "november",
      "desember",
    ];
    months.forEach((month, index) => {
      const parsed = parseEventTimeText(`1 ${month} 2026`, Date.UTC(2026, index, 2), "WIB");
      expect(parsed).toEqual({
        value: { kind: "dateOnly", localDate: `2026-${String(index + 1).padStart(2, "0")}-01`, zone: "WIB" },
      });
    });
  });

  test("text around a date is not glued into an hour", () => {
    expect(parseEventTimeText("jam 7.3 des 202645", Date.UTC(2026, 11, 30, 5), "WIB")).toEqual({
      value: { kind: "dateTime", localDate: "2026-12-03", localTime: "07:00", zone: "WIB" },
    });
  });

  test("the date words are not read as an hour", () => {
    expect(value("19.11.2026")).toEqual({ value: { kind: "dateOnly", localDate: "2026-11-19", zone: "WIB" } });
  });
});
