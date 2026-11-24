import { describe, expect, test } from "vitest";
import type { ReportRecord } from "../adapters/d1/reports";
import { racing, testBindings } from "../testing/api";
import { trackingOf } from "./tracking";

const report: ReportRecord = {
  id: "r-1",
  ticketNumber: "LA-231126-01",
  draftId: "d-1",
  reporterId: "p-1",
  numberKey: "k",
  ownerSlot: "s",
  hazardType: "flood",
  villageCode: "11.08.01.2001",
  sentAt: new Date("2026-11-23T02:00:00.000Z"),
  status: "new",
  states: {
    place: {
      state: "value",
      value: {
        villageCode: "11.08.01.2001",
        villageName: "A",
        districtName: "B",
        regencyName: "Aceh Utara",
        provinceName: "Aceh",
      },
    },
    hazardSubtype: { state: "confirmedUnknown" },
  },
  reporterName: "Uji Satu",
  rating: null,
  photoCount: 0,
  history: [{ toStatus: "new", atMs: Date.parse("2026-11-23T02:00:00.000Z") }],
};

describe("tracking view", () => {
  test("an answer of not known is shown as nothing, and a missing event time as none", async () => {
    const { bindings } = testBindings();
    const view = await trackingOf(bindings, report);
    expect(view).toMatchObject({
      hazardSubtype: null,
      eventTime: null,
      contact: { level: "regency", phone: "0800-1108-0001" },
    });
  });

  test("a contact file that cannot be read gives 117 and logs only the SQLite code", async () => {
    for (const [message, sqlState] of [
      ["D1_ERROR: no such table: SQLITE_ERROR", { sqlState: "SQLITE_ERROR" }],
      ["network gone", {}],
    ] as const) {
      const { bindings, lines } = testBindings();
      const db = racing(
        async () => "pass",
        async (text) => {
          if (text.includes("reference_file")) throw new Error(message);
        },
      );
      expect((await trackingOf({ ...bindings, db }, report)).contact).toEqual({ level: "national" });
      expect(lines.at(-1)).toEqual({ event: "contacts.failed", errorCode: "contacts.unavailable", ...sqlState });
    }
  });
});
