import { describe, expect, test } from "vitest";
import { hazardIcon } from "../../../lib/hazardIcons";
import { rowParts } from "../../../lib/summary";
import { text } from "../../../testing/render";
import { deskLink, eventShort, spacedNumber } from "./parts";

const FILTERS = { view: "list" as const, status: "", hazardType: "", period: "all", ticket: "", page: 1 };

describe("desk helpers", () => {
  test("a desk address carries only the filters in use", () => {
    expect(deskLink(FILTERS)).toBe("/lapor/meja");
    expect(deskLink(FILTERS, { view: "map", status: "seen", page: 3 })).toBe("/lapor/meja?view=map&status=seen&page=3");
    expect(deskLink({ ...FILTERS, period: "week", ticket: "LA-1" })).toBe("/lapor/meja?period=week&ticket=LA-1");
  });

  test("an event's time reads short, with its hour when known", () => {
    expect(eventShort(text, { kind: "dateOnly", localDate: "2026-11-24", zone: "WIB" })).toBe("24 Nov 2026");
    expect(eventShort(text, { kind: "dateTime", localDate: "2026-11-24", localTime: "08:15", zone: "WITA" })).toBe(
      "24 Nov 2026, 08.15 WITA",
    );
    expect(eventShort(text, { kind: "olderThan30Days" })).toBe("Sudah lebih dari 30 hari");
  });

  test("a stored number reads in groups", () => {
    expect(spacedNumber("+6281234567890")).toBe("+62 812-3456-7890");
  });
});

describe("desk pieces from shared helpers", () => {
  test("an old report of the legacy type still gets an icon", () => {
    expect(hazardIcon("flood")).toBe("droplets");
    expect(hazardIcon("other")).toBe("circleHelp");
  });

  test("a row reads as label and value apart; a value with nothing in it reads as not yet known", () => {
    const row = { fieldId: "dead", state: "value" as const, origin: "boxEntry" as const, quote: null };
    expect(rowParts(text, { ...row, value: { kind: "count", count: 2 } }, "flood")).toEqual({
      label: "Meninggal",
      value: "2 orang",
      state: "value",
    });
    expect(rowParts(text, { ...row, value: null }, "flood")).toEqual({
      label: "Meninggal",
      value: null,
      state: "notYetKnown",
    });
    expect(rowParts(text, { ...row, state: "none", value: null }, null).state).toBe("none");
  });
});
