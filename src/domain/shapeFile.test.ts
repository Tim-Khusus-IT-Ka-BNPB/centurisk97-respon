import { describe, expect, test } from "vitest";
import seedShapes from "../../db/reference/village-shapes.json";
import { checkShapeFiles } from "./shapeFile";

const ring = [
  [106.8, -6.2],
  [106.82, -6.2],
  [106.82, -6.18],
  [106.8, -6.2],
];
const feature = (kd: unknown, geometry: unknown) => ({ type: "Feature", properties: { kd }, geometry });
const file = (...features: unknown[]) => ({ type: "FeatureCollection", features });

describe("shape files", () => {
  test("a polygon and a multipolygon become one ring list with a box and its middle", () => {
    const checked = checkShapeFiles([
      file(feature("32.71.01.1001", { type: "Polygon", coordinates: [ring] })),
      file(feature("32.71.01.1002", { type: "MultiPolygon", coordinates: [[ring], [ring]] })),
    ]);
    expect(checked).toEqual({
      ok: true,
      shapes: [
        {
          code: "32.71.01.1001",
          minLat: -6.2,
          minLon: 106.8,
          maxLat: -6.18,
          maxLon: 106.82,
          centreLat: (-6.2 + -6.18) / 2,
          centreLon: (106.8 + 106.82) / 2,
          rings: [ring],
        },
        expect.objectContaining({ code: "32.71.01.1002", rings: [ring, ring] }),
      ],
    });
  });

  test("the pinned seed outlines hold one per seed village", () => {
    const checked = checkShapeFiles([seedShapes]);
    expect(checked.ok && checked.shapes.length).toBe(967);
  });

  test("a file or feature that breaks the contract is refused with where it broke", () => {
    expect(checkShapeFiles([{ type: "Feature" }])).toEqual({ ok: false, problem: { kind: "shape" } });
    expect(checkShapeFiles([null])).toEqual({ ok: false, problem: { kind: "shape" } });
    const broken = [
      feature("32.71", { type: "Polygon", coordinates: [ring] }),
      feature(3271, { type: "Polygon", coordinates: [ring] }),
      feature("32.71.01.1001", { type: "Point", coordinates: [106.8, -6.2] }),
      feature("32.71.01.1001", { type: "Polygon", coordinates: [] }),
      feature("32.71.01.1001", { type: "Polygon", coordinates: [ring.slice(0, 3)] }),
      feature("32.71.01.1001", {
        type: "Polygon",
        coordinates: [
          [
            [106.8, -6.2],
            [200, 0],
            [1, 1],
            [106.8, -6.2],
          ],
        ],
      }),
      feature("32.71.01.1001", {
        type: "Polygon",
        coordinates: [
          [
            [106.8, -95],
            [1, 0],
            [1, 1],
            [106.8, -6.2],
          ],
        ],
      }),
      feature("32.71.01.1001", {
        type: "Polygon",
        coordinates: [
          [
            ["a", 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      }),
      feature("32.71.01.1001", { type: "Polygon", coordinates: [[[1], [1, 0], [1, 1], [0, 0]]] }),
      feature("32.71.01.1001", { type: "MultiPolygon", coordinates: [] }),
      feature("32.71.01.1001", { type: "MultiPolygon", coordinates: "x" }),
      feature("32.71.01.1001", { type: "MultiPolygon", coordinates: [[ring], "x"] }),
      feature("32.71.01.1001", null),
      null,
    ];
    for (const one of broken)
      expect(checkShapeFiles([file(one)])).toEqual({ ok: false, problem: { kind: "feature", index: 0 } });
    const good = feature("32.71.01.1001", { type: "Polygon", coordinates: [ring] });
    expect(checkShapeFiles([file(good), file(good)])).toEqual({
      ok: false,
      problem: { kind: "duplicate", code: "32.71.01.1001" },
    });
    expect(checkShapeFiles([file(good, broken[0])])).toEqual({ ok: false, problem: { kind: "feature", index: 1 } });
  });
});
