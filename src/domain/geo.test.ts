import { describe, expect, test } from "vitest";
import { distanceKm, inIndonesia, insideRings, nearestCentres, precisionOf, type Ring, resolveVillage } from "./geo";

// A 0.02 degree square with a 0.01 degree hole in its middle.
const square: Ring = [
  [106.8, -6.2],
  [106.82, -6.2],
  [106.82, -6.18],
  [106.8, -6.18],
  [106.8, -6.2],
];
const hole: Ring = [
  [106.805, -6.195],
  [106.815, -6.195],
  [106.815, -6.185],
  [106.805, -6.185],
  [106.805, -6.195],
];

describe("geo", () => {
  test("distance is upstream's equirectangular kilometres", () => {
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.19, 1);
    expect(distanceKm({ lat: -6.2, lon: 106.8 }, { lat: -6.2, lon: 106.8 })).toBe(0);
  });

  test("Indonesia's box excludes its edges and anything not a number", () => {
    expect(inIndonesia({ lat: -6.2, lon: 106.8 })).toBe(true);
    expect(inIndonesia({ lat: 40, lon: -3 })).toBe(false);
    expect(inIndonesia({ lat: 6.5, lon: 100 })).toBe(false);
    expect(inIndonesia({ lat: -11.5, lon: 100 })).toBe(false);
    expect(inIndonesia({ lat: 0, lon: 94 })).toBe(false);
    expect(inIndonesia({ lat: 0, lon: 141.5 })).toBe(false);
    expect(inIndonesia({ lat: Number.NaN, lon: 100 })).toBe(false);
    expect(inIndonesia({ lat: 0, lon: Number.POSITIVE_INFINITY })).toBe(false);
  });

  test("a point is inside an outline by even-odd crossings, so a hole is outside", () => {
    expect(insideRings({ lat: -6.198, lon: 106.802 }, [square, hole])).toBe(true);
    expect(insideRings({ lat: -6.19, lon: 106.81 }, [square, hole])).toBe(false);
    expect(insideRings({ lat: -6.1, lon: 106.81 }, [square])).toBe(false);
  });

  test("the outline holding the point wins; else the nearest centre within 3 km; else none", () => {
    const outlines = [{ code: "A", rings: [square] }];
    const centres = [
      { code: "A", centre: { lat: -6.19, lon: 106.81 } },
      { code: "B", centre: { lat: -6.17, lon: 106.81 } },
    ];
    expect(resolveVillage({ lat: -6.198, lon: 106.802 }, outlines, centres)).toEqual({ code: "A", exact: true });
    expect(resolveVillage({ lat: -6.16, lon: 106.81 }, outlines, centres)).toEqual({ code: "B", exact: false });
    expect(resolveVillage({ lat: -6.0, lon: 106.81 }, outlines, centres)).toBeNull();
    expect(resolveVillage({ lat: -6.0, lon: 106.81 }, [], [])).toBeNull();
  });

  test("nearest centres are sorted by distance, then code, without the one read", () => {
    const point = { lat: 0, lon: 0 };
    const centres = [
      { code: "C", centre: { lat: 0, lon: 0.02 } },
      { code: "B", centre: { lat: 0.01, lon: 0 } },
      { code: "A", centre: { lat: -0.01, lon: 0 } },
      { code: "X", centre: { lat: 0, lon: 0 } },
    ];
    expect(nearestCentres(point, centres, 2, "X").map((one) => one.code)).toEqual(["A", "B"]);
    expect(nearestCentres(point, centres, 5).map((one) => one.code)).toEqual(["X", "A", "B", "C"]);
  });

  test("accuracy of 1,000 m or better is a GPS point", () => {
    expect(precisionOf(12)).toBe("gpsPoint");
    expect(precisionOf(1000)).toBe("gpsPoint");
    expect(precisionOf(1001)).toBe("estimate");
  });
});
