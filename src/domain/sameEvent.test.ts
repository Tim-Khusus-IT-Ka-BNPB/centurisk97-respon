import { describe, expect, test } from "vitest";
import { pickOffers, type SameEventCandidate } from "./sameEvent";
import { HOUR_MS } from "./time";

const NOW = Date.UTC(2026, 10, 24, 12);
let n = 0;
const candidate = (extra: Partial<SameEventCandidate> = {}): SameEventCandidate => {
  n += 1;
  return {
    ticketNumber: `LA-241126-${String(n).padStart(2, "0")}`,
    hazardType: "flood",
    hazardSubtype: null,
    eventTime: null,
    eventMs: null,
    sentMs: NOW - HOUR_MS,
    status: "new",
    reporters: 1,
    ...extra,
  };
};

describe("reports offered as the same event", () => {
  test("one per hazard, the newest first, at most three, each since its event time or send", () => {
    const older = candidate({ sentMs: NOW - 3 * HOUR_MS });
    const newer = candidate({ sentMs: NOW - 2 * HOUR_MS, eventMs: NOW - 2.5 * HOUR_MS, reporters: 4 });
    const drought = candidate({ hazardType: "drought", sentMs: NOW - HOUR_MS });
    const fire = candidate({ hazardType: "buildingFire", sentMs: NOW - 4 * HOUR_MS });
    const quake = candidate({ hazardType: "earthquake", sentMs: NOW - 5 * HOUR_MS });
    const offers = pickOffers([older, newer, drought, fire, quake], NOW);
    expect(offers.map((offer) => offer.ticketNumber)).toEqual([
      drought.ticketNumber,
      newer.ticketNumber,
      fire.ticketNumber,
    ]);
    expect(offers[1]).toEqual({
      ticketNumber: newer.ticketNumber,
      hazardType: "flood",
      hazardSubtype: null,
      eventTime: null,
      sinceMs: NOW - 2.5 * HOUR_MS,
      reporters: 4,
    });
    expect(offers[0]?.sinceMs).toBe(drought.sentMs);
  });

  test("a newer event time wins over an earlier send, within a hazard", () => {
    const late = candidate({ sentMs: NOW - 5 * HOUR_MS, eventMs: NOW - HOUR_MS });
    const sooner = candidate({ sentMs: NOW - 2 * HOUR_MS });
    expect(pickOffers([sooner, late], NOW).map((offer) => offer.ticketNumber)).toEqual([late.ticketNumber]);
    expect(pickOffers([late, sooner], NOW).map((offer) => offer.ticketNumber)).toEqual([late.ticketNumber]);
    // Two as new: the first read stays.
    const twin = candidate({ sentMs: NOW - HOUR_MS });
    expect(pickOffers([late, twin], NOW).map((offer) => offer.ticketNumber)).toEqual([late.ticketNumber]);
  });

  test("closed and set aside are never offered", () => {
    expect(pickOffers([candidate({ status: "closed" }), candidate({ status: "invalid" })], NOW)).toEqual([]);
    expect(pickOffers([candidate({ status: "in_handling" })], NOW)).toHaveLength(1);
  });

  test("within its hazard's window only: 6 hours for a flood, 12 for a quake, 72 for a drought", () => {
    for (const [hazardType, hours] of [
      ["flood", 6],
      ["earthquake", 12],
      ["drought", 72],
    ] as const) {
      expect(pickOffers([candidate({ hazardType, sentMs: NOW - hours * HOUR_MS })], NOW), hazardType).toHaveLength(1);
      expect(pickOffers([candidate({ hazardType, sentMs: NOW - hours * HOUR_MS - 1 })], NOW), hazardType).toEqual([]);
    }
  });
});
