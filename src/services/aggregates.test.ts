import { describe, expect, test } from "vitest";
import type { AggregateRowData } from "../adapters/postgres/aggregates";
import { inputOf } from "./aggregates";

const row = (eventTime: object | undefined): AggregateRowData => ({
  hazard_type: "flood",
  province_code: "11",
  regency_code: "11.08",
  number_key: "k",
  status: "new",
  sent_at: "2026-11-24T03:00:00.000Z",
  fields: {
    place: { state: "value", value: { provinceName: "Aceh", regencyName: "Aceh Utara" } },
    eventTime,
  },
  placed_photo: false,
});

describe("a report read for the weekly counts", () => {
  test("an event time with its hour is used; a date alone or none leaves it out", () => {
    const timed = {
      state: "value",
      value: { kind: "dateTime", localDate: "2026-11-24", localTime: "08:00", zone: "WIB" },
    };
    expect(inputOf(row(timed)).eventMs).toBe(Date.UTC(2026, 10, 24, 1));
    expect(
      inputOf(row({ state: "value", value: { kind: "dateOnly", localDate: "2026-11-24", zone: "WIB" } })).eventMs,
    ).toBeNull();
    expect(inputOf(row({ state: "notYetKnown" }))).toMatchObject({
      eventMs: null,
      regencyName: "Aceh Utara",
      placedPhoto: false,
    });
    expect(inputOf(row(undefined)).eventMs).toBeNull();
  });
});
