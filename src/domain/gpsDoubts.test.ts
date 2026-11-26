import { describe, expect, test } from "vitest";
import { distanceKm } from "./geo";
import { type GpsDoubtInput, gpsDoubts, JUMP } from "./gpsDoubts";

const HERE = { lat: -6.2, lon: 106.8 };
const NOW = Date.UTC(2026, 10, 27, 3);
const HOUR = 3_600_000;
const calm: GpsDoubtInput = {
  point: HERE,
  atMs: NOW,
  phoneZone: "Asia/Jakarta",
  placeZone: "WIB",
  country: "ID",
  previous: null,
};
// A point this many km north of HERE.
const north = (km: number) => ({ lat: HERE.lat + km / 111.195, lon: HERE.lon });

describe("doubts about a photo's GPS (D11)", () => {
  test("a phone in the place's zone, in Indonesia, with no jump: none; with no point nothing is doubted", () => {
    expect(gpsDoubts(calm)).toEqual([]);
    expect(gpsDoubts({ ...calm, point: null, phoneZone: "Europe/London", country: "SG" })).toEqual([]);
    expect(gpsDoubts({ ...calm, phoneZone: null, country: null })).toEqual([]);
    expect(gpsDoubts({ ...calm, phoneZone: "Asia/Pontianak" })).toEqual([]);
    expect(gpsDoubts({ ...calm, phoneZone: "Asia/Makassar", placeZone: "WITA" })).toEqual([]);
    expect(gpsDoubts({ ...calm, phoneZone: "Asia/Jayapura", placeZone: "WIT" })).toEqual([]);
  });

  test("a phone clock in another zone, or one no Indonesian phone uses", () => {
    expect(gpsDoubts({ ...calm, phoneZone: "Asia/Makassar" })).toEqual(["zone"]);
    expect(gpsDoubts({ ...calm, phoneZone: "Europe/London" })).toEqual(["zone"]);
    expect(gpsDoubts({ ...calm, phoneZone: "constructor" })).toEqual(["zone"]);
  });

  test("a network outside Indonesia", () => {
    expect(gpsDoubts({ ...calm, country: "SG" })).toEqual(["abroad"]);
  });

  test("a jump of more than 50 km faster than 300 km an hour from the photo before", () => {
    expect(JUMP).toEqual({ minKm: 50, maxKmPerHour: 300 });
    const far = north(120);
    expect(distanceKm(far, HERE)).toBeGreaterThan(119);
    expect(gpsDoubts({ ...calm, previous: { point: far, atMs: NOW - HOUR / 4 } })).toEqual(["jump"]);
    // Slow enough: 120 km in an hour.
    expect(gpsDoubts({ ...calm, previous: { point: far, atMs: NOW - HOUR } })).toEqual([]);
    // Near enough, however fast.
    expect(gpsDoubts({ ...calm, previous: { point: north(49), atMs: NOW } })).toEqual([]);
    // Taken at once, the time counts as a minute: 51 km in a minute is a jump.
    expect(gpsDoubts({ ...calm, previous: { point: north(51), atMs: NOW } })).toEqual(["jump"]);
    // 60 km in 12 minutes is exactly 300 km an hour: not over it.
    expect(gpsDoubts({ ...calm, previous: { point: north(60), atMs: NOW - HOUR / 5 } })).toEqual([]);
    expect(gpsDoubts({ ...calm, phoneZone: "UTC", country: "MY", previous: { point: far, atMs: NOW } })).toEqual([
      "zone",
      "abroad",
      "jump",
    ]);
  });
});
