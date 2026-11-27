import { expect, test } from "vitest";
import { provinceRings } from "./provinceRings";

const item = (provinceName: string, hazardType: string, lat: number | null, lon = 100) => ({
  provinceName,
  hazardType,
  point: lat === null ? null : { lat, lon },
});

test("a ring per province at the middle of its points, its slices by hazard, the most first", () => {
  expect(
    provinceRings([
      item("Aceh", "landslide", 4, 96),
      item("Aceh", "flood", 6, 98),
      item("Aceh", "flood", null),
      item("Aceh", "flood", 5, 97),
      item("Bali", "flood", -8, 115),
      item("Papua", "flood", null),
    ]),
  ).toEqual([
    {
      provinceName: "Aceh",
      point: { lat: 5, lon: 97 },
      total: 4,
      slices: [
        { hazardType: "flood", count: 3 },
        { hazardType: "landslide", count: 1 },
      ],
    },
    { provinceName: "Bali", point: { lat: -8, lon: 115 }, total: 1, slices: [{ hazardType: "flood", count: 1 }] },
  ]);
  expect(provinceRings([])).toEqual([]);
});
