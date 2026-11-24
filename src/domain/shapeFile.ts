// Upstream's village outline files (public/geo/desa/<regency>.json): a GeoJSON FeatureCollection
// per regency, one feature per village with its code as properties.kd and a Polygon or
// MultiPolygon in [lon, lat]. No imports, so the Node import scripts share this contract.

type Pair = readonly [number, number];

export type ShapeRecord = {
  readonly code: string;
  readonly minLat: number;
  readonly minLon: number;
  readonly maxLat: number;
  readonly maxLon: number;
  // The middle of the box, which upstream uses as the village centre.
  readonly centreLat: number;
  readonly centreLon: number;
  readonly rings: readonly (readonly Pair[])[];
};

export type ShapeFileProblem =
  | { readonly kind: "shape" }
  | { readonly kind: "feature"; readonly index: number }
  | { readonly kind: "duplicate"; readonly code: string };

export type ShapeFileCheck =
  | { readonly ok: true; readonly shapes: readonly ShapeRecord[] }
  | { readonly ok: false; readonly problem: ShapeFileProblem };

const VILLAGE_CODE = /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/;

const isPair = (value: unknown): value is Pair =>
  Array.isArray(value) &&
  value.length >= 2 &&
  Number.isFinite(value[0]) &&
  Number.isFinite(value[1]) &&
  Math.abs(value[0] as number) <= 180 &&
  Math.abs(value[1] as number) <= 90;

const isRing = (value: unknown): value is Pair[] => Array.isArray(value) && value.length >= 4 && value.every(isPair);

const isPolygon = (value: unknown): value is Pair[][] =>
  Array.isArray(value) && value.length > 0 && value.every(isRing);

const copied = (polygon: Pair[][]): Pair[][] => polygon.map((ring) => ring.map(([x, y]): Pair => [x, y]));

// Every ring of every polygon, outer rings and holes alike, as one list.
function ringsOf(geometry: unknown): Pair[][] | null {
  const { type, coordinates } = (geometry ?? {}) as { type?: unknown; coordinates?: unknown };
  if (type === "Polygon") return isPolygon(coordinates) ? copied(coordinates) : null;
  if (type !== "MultiPolygon" || !Array.isArray(coordinates) || coordinates.length === 0) return null;
  return coordinates.every(isPolygon) ? (coordinates as Pair[][][]).flatMap(copied) : null;
}

// A loop, not Math.min(...): a large outline has more points than a call takes arguments.
function recordOf(code: string, rings: Pair[][]): ShapeRecord {
  let [minLat, minLon, maxLat, maxLon] = [90, 180, -90, -180];
  for (const ring of rings)
    for (const [lon, lat] of ring) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    }
  return {
    code,
    minLat,
    minLon,
    maxLat,
    maxLon,
    centreLat: (minLat + maxLat) / 2,
    centreLon: (minLon + maxLon) / 2,
    rings,
  };
}

// Checks one or more outline files against the contract before anything is written.
export function checkShapeFiles(files: readonly unknown[]): ShapeFileCheck {
  const seen = new Set<string>();
  const shapes: ShapeRecord[] = [];
  let index = 0;
  for (const json of files) {
    const { type, features } = (json ?? {}) as { type?: unknown; features?: unknown };
    if (type !== "FeatureCollection" || !Array.isArray(features)) return { ok: false, problem: { kind: "shape" } };
    for (const feature of features) {
      const code = (feature as { properties?: { kd?: unknown } } | null)?.properties?.kd;
      const rings = ringsOf((feature as { geometry?: unknown } | null)?.geometry);
      if (typeof code !== "string" || !VILLAGE_CODE.test(code) || rings === null)
        return { ok: false, problem: { kind: "feature", index } };
      if (seen.has(code)) return { ok: false, problem: { kind: "duplicate", code } };
      seen.add(code);
      shapes.push(recordOf(code, rings));
      index += 1;
    }
  }
  return { ok: true, shapes };
}
