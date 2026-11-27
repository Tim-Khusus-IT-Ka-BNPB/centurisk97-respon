import { expect, test } from "vitest";
import SEED from "../../db/reference/facility-numbers.json";
import { checkFacilityFile, type FacilityFile } from "./facilities";
import { NEAR, nearestFacilities } from "./nearFacilities";

const rs = ["rs", 5.15, 97.05, "RSUD Uji", "+628001108001"];
const file = (...fasilitas: unknown[]) => ({ dibuat: "2026-11-27", sumber: "OpenStreetMap", fasilitas });

test("the seed passes; no source, date or place, or one broken place, does not", () => {
  expect(checkFacilityFile(SEED)).not.toBeNull();
  expect(checkFacilityFile(file(rs, ["damkar", 1, 2, "Damkar", "113"]))).not.toBeNull();
  for (const broken of [
    null,
    { ...file(rs), sumber: 1 },
    { ...file(rs), dibuat: "kemarin" },
    { ...file(rs), dibuat: 5 },
    file(),
    { ...file(rs), fasilitas: "x" },
    file(rs, null),
    file(["klinik", 1, 2, "X", "+628001"]),
    file(["rs", "1", 2, "X", "+6280011080"]),
    file(["rs", 1, "2", "X", "+6280011080"]),
    file(["rs", 1, 2, 3, "+6280011080"]),
    file(["rs", 1, 2, "X", "0812 345"]),
    file(["rs", 1, 2, "X", "+62"]),
    file(["rs", 1, 2, "X", "12"]),
  ])
    expect(checkFacilityFile(broken), JSON.stringify(broken)).toBeNull();
});

test("two of each kind at most within 30 km, nearest first, in upstream's order of kinds", () => {
  const here = { lat: 5.15, lon: 97.05 };
  // A tenth of a degree of latitude is 11.1 km.
  const at = (kind: string, northKm: number, name: string) => [kind, here.lat + northKm / 111.2, here.lon, name, "112"];
  const near = nearestFacilities(
    checkFacilityFile(
      file(
        at("polisi", 2, "Polsek"),
        at("rs", 9, "RS Jauh"),
        at("rs", 1, "RS Dekat"),
        at("rs", 5, "RS Tengah"),
        at("damkar", 31, "Damkar Jauh"),
        at("puskesmas", 0.04, "Puskesmas"),
      ),
    ) as FacilityFile,
    here,
  );
  expect(near.map((one) => [one.kind, one.name, one.km])).toEqual([
    ["rs", "RS Dekat", 1],
    ["rs", "RS Tengah", 5],
    ["puskesmas", "Puskesmas", 0],
    ["polisi", "Polsek", 2],
  ]);
  expect(NEAR).toEqual({ perKind: 2, maxKm: 30 });
  expect(nearestFacilities(checkFacilityFile(file(at("rs", 30, "Tepi"))) as FacilityFile, here)).toHaveLength(1);
});
