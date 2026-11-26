import { describe, expect, test } from "vitest";
import { type ClusterInput, clusterOfTicket, clustersOf } from "./clusters";
import { HOUR_MS } from "./time";

const T0 = Date.UTC(2026, 10, 25, 3);
const A = { lat: -6.2, lon: 106.9 };
// About 2.2, 4.4 and 5.5 km east of A.
const NEAR = { lat: -6.2, lon: 106.92 };
const MID = { lat: -6.2, lon: 106.94 };
const FAR = { lat: -6.2, lon: 106.95 };

let n = 0;
const report = (extra: Partial<ClusterInput> = {}): ClusterInput => {
  n += 1;
  return {
    ticketNumber: `LA-251126-${String(n).padStart(2, "0")}`,
    hazardType: "flood",
    point: A,
    villageCode: "31.75.06.1001",
    regencyCode: "31.75",
    atMs: T0,
    numberKey: `k${n}`,
    placedPhoto: false,
    status: "new",
    ...extra,
  };
};

// A point this many km east of A.
const east = (km: number) => ({
  lat: A.lat,
  lon: A.lon + km / ((6371 * Math.PI * Math.cos((A.lat * Math.PI) / 180)) / 180),
});

describe("each hazard's reach", () => {
  test.each([
    ["flood", 3, 6],
    ["landslide", 3, 6],
    ["buildingFire", 3, 6],
    ["extremeWeather", 5, 6],
    ["forestFire", 5, 12],
  ])("%s joins within %d km and %d hours, and no further", (hazardType, km, hours) => {
    const pair = (point: { lat: number; lon: number }, atMs = T0) => [
      report({ hazardType }),
      report({ hazardType, point, villageCode: "elsewhere", atMs }),
    ];
    expect(clustersOf(pair(east(km - 0.1), T0 + hours * HOUR_MS))).toHaveLength(1);
    expect(clustersOf(pair(east(km + 0.1)))).toEqual([]);
    expect(clustersOf(pair(east(0), T0 + hours * HOUR_MS + 1))).toEqual([]);
  });

  test.each([
    ["earthquake", 12],
    ["volcanicEruption", 12],
    ["tsunami", 12],
  ])("%s joins across its regency within %d hours", (hazardType, hours) => {
    const far = { hazardType, point: east(50), villageCode: "elsewhere" };
    expect(clustersOf([report({ hazardType }), report({ ...far, atMs: T0 + hours * HOUR_MS })])).toHaveLength(1);
    expect(clustersOf([report({ hazardType }), report({ ...far, atMs: T0 + hours * HOUR_MS + 1 })])).toEqual([]);
  });
});

describe("the edge of the reach", () => {
  // On the equator these points are exactly 3 and 5 km from the origin, as distanceKm computes it.
  test.each([
    ["flood", 0.026979648177561915],
    ["extremeWeather", 0.04496608029593653],
  ])("%s joins at exactly its distance", (hazardType, lat) => {
    const origin = { lat: 0, lon: 0 };
    const pair = [
      report({ hazardType, point: origin }),
      report({ hazardType, point: { lat, lon: 0 }, villageCode: "elsewhere" }),
    ];
    expect(clustersOf(pair)).toHaveLength(1);
  });
});

describe("clusters of reports", () => {
  test("two numbers within 3 km and 6 hours make one cluster, oldest first, figures never added", () => {
    const later = report({ point: NEAR, atMs: T0 + 6 * HOUR_MS });
    const first = report();
    expect(clustersOf([later, first])).toEqual([
      { tickets: [first.ticketNumber, later.ticketNumber], hazardType: "flood", reporters: 2, strong: false },
    ]);
  });

  test("one number alone never makes a cluster, however many reports it sends", () => {
    expect(clustersOf([report({ numberKey: "same" }), report({ numberKey: "same" })])).toEqual([]);
  });

  test("past the distance, past the hours, another hazard or set aside: apart", () => {
    expect(clustersOf([report(), report({ point: FAR, villageCode: "31.75.06.1002" })])).toEqual([]);
    expect(clustersOf([report(), report({ atMs: T0 + 6 * HOUR_MS + 1 })])).toEqual([]);
    expect(clustersOf([report(), report({ atMs: T0 - 6 * HOUR_MS - 1 })])).toEqual([]);
    expect(clustersOf([report(), report({ hazardType: "landslide" })])).toEqual([]);
    expect(clustersOf([report(), report({ status: "invalid" })])).toEqual([]);
  });

  test("a place picked by name joins by its village; a point far off still joins its own village", () => {
    expect(clustersOf([report({ point: null }), report()])).toHaveLength(1);
    expect(clustersOf([report(), report({ point: null })])).toHaveLength(1);
    expect(clustersOf([report({ point: null }), report({ point: null, villageCode: "31.75.06.1002" })])).toEqual([]);
    expect(clustersOf([report({ point: FAR }), report()])).toHaveLength(1);
  });

  test("weather and forest fires reach 5 km, and a forest fire 12 hours", () => {
    expect(clustersOf([report(), report({ point: MID, villageCode: "x" })])).toEqual([]);
    expect(
      clustersOf([
        report({ hazardType: "extremeWeather" }),
        report({ hazardType: "extremeWeather", point: MID, villageCode: "x" }),
      ]),
    ).toHaveLength(1);
    expect(
      clustersOf([
        report({ hazardType: "forestFire" }),
        report({ hazardType: "forestFire", point: FAR, villageCode: "x" }),
      ]),
    ).toEqual([]);
    expect(
      clustersOf([report({ hazardType: "forestFire" }), report({ hazardType: "forestFire", atMs: T0 + 12 * HOUR_MS })]),
    ).toHaveLength(1);
    expect(
      clustersOf([
        report({ hazardType: "forestFire" }),
        report({ hazardType: "forestFire", atMs: T0 + 12 * HOUR_MS + 1 }),
      ]),
    ).toEqual([]);
  });

  test("an earthquake, an eruption and a tsunami join across a regency within 12 hours", () => {
    for (const hazardType of ["earthquake", "volcanicEruption", "tsunami"]) {
      const apart = { hazardType, point: FAR, villageCode: "x", atMs: T0 + 12 * HOUR_MS };
      expect(clustersOf([report({ hazardType }), report(apart)])).toHaveLength(1);
      expect(clustersOf([report({ hazardType }), report({ ...apart, regencyCode: "31.74" })])).toEqual([]);
    }
  });

  test("drought, abrasion and other are not clustered", () => {
    for (const hazardType of ["drought", "tidalWaveAbrasion", "other"])
      expect(clustersOf([report({ hazardType }), report({ hazardType })])).toEqual([]);
  });

  test("a chain joins: each near the next, the ends apart", () => {
    const chain = [
      report(),
      report({ point: NEAR, villageCode: "b", atMs: T0 + HOUR_MS }),
      report({ point: MID, villageCode: "c", atMs: T0 + 2 * HOUR_MS }),
    ];
    expect(clustersOf(chain)[0]?.tickets).toHaveLength(3);
    const reversed = clustersOf([...chain].reverse());
    expect(reversed[0]?.tickets).toEqual(chain.map((one) => one.ticketNumber));
  });

  test("strong: three numbers, or placed photos from two of them", () => {
    expect(clustersOf([report(), report(), report()])[0]?.strong).toBe(true);
    expect(clustersOf([report({ placedPhoto: true }), report({ placedPhoto: true })])[0]?.strong).toBe(true);
    const onePhotographer = [
      report({ placedPhoto: true, numberKey: "p" }),
      report({ placedPhoto: true, numberKey: "p" }),
      report(),
    ];
    expect(clustersOf(onePhotographer)[0]).toMatchObject({ reporters: 2, strong: false });
  });

  test("clusters come oldest first, and each ticket finds its own", () => {
    const late = [report({ atMs: T0 + 48 * HOUR_MS }), report({ atMs: T0 + 48 * HOUR_MS })];
    const early = [report({ hazardType: "landslide" }), report({ hazardType: "landslide" })];
    const clusters = clustersOf([...late, ...early, report({ point: null, villageCode: "alone" })]);
    expect(clusters.map((cluster) => cluster.hazardType)).toEqual(["landslide", "flood"]);
    const byTicket = clusterOfTicket(clusters);
    expect(byTicket.get(late[1]?.ticketNumber as string)).toBe(clusters[1]);
    expect(byTicket.size).toBe(4);
  });
});
