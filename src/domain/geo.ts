// Points, distances and village outlines. Pure: the database hands in the candidates.

export type Point = { readonly lat: number; readonly lon: number };

// One ring as [lon, lat] pairs, as the outline files store them. Outer rings and holes share one
// list: a point is inside when it crosses an odd number of edges across all of them.
export type Ring = readonly (readonly [number, number])[];

export const GEO = {
  // GPS accuracy at or under this is a GPS point; worse is an estimate (D10).
  pointAccuracyM: 1000,
  // With no outline holding the point, the nearest village centre this close is taken.
  nearestCentreKm: 3,
  nearbyVillages: 5,
  // A photo's place this far from the device now is refused.
  photoFromDeviceKm: 5,
  // A photo this far from the report's place is kept with the far badge (A4).
  photoFarFromPlaceKm: 10,
  // A device reading older than this is not used for a photo.
  deviceFixMaxAgeMs: 10 * 60_000,
} as const;

const EARTH_KM = 6371;
const RAD = Math.PI / 180;

// Upstream's equirectangular distance: exact enough at the few kilometres these rules use.
export function distanceKm(a: Point, b: Point): number {
  const meanLat = ((a.lat + b.lat) / 2) * RAD;
  return EARTH_KM * Math.hypot((b.lon - a.lon) * RAD * Math.cos(meanLat), (b.lat - a.lat) * RAD);
}

// The box around the country that upstream refuses a point outside of, edges excluded. NaN fails
// every comparison.
export const inIndonesia = (point: Point): boolean =>
  point.lat > -11.5 && point.lat < 6.5 && point.lon > 94 && point.lon < 141.5;

export function insideRings(point: Point, rings: readonly Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as readonly [number, number];
      const [xj, yj] = ring[j] as readonly [number, number];
      const spans = yi > point.lat !== yj > point.lat;
      // Stryker disable next-line EqualityOperator,ArithmeticOperator: on a closed ring the crossings left and right of a point have the same parity, and the regrouped product differs only in rounding
      if (spans && point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export type Outline = { readonly code: string; readonly rings: readonly Ring[] };
export type Centre = { readonly code: string; readonly centre: Point };

export type Resolved = { readonly code: string; readonly exact: boolean };

// The village whose outline holds the point, else the nearest centre within 3 km, else none.
// Outlines are simplified, so the reporter always confirms what this reads.
export function resolveVillage(
  point: Point,
  outlines: readonly Outline[],
  centres: readonly Centre[],
): Resolved | null {
  const holding = outlines.find((outline) => insideRings(point, outline.rings));
  if (holding) return { code: holding.code, exact: true };
  const nearest = nearestCentres(point, centres, 1)[0];
  // Stryker disable next-line EqualityOperator: a centre exactly 3 km away is not writable in floats
  return nearest && nearest.km <= GEO.nearestCentreKm ? { code: nearest.code, exact: false } : null;
}

export type Nearby = { readonly code: string; readonly km: number };

export function nearestCentres(
  point: Point,
  centres: readonly Centre[],
  count: number,
  except: string | null = null,
): Nearby[] {
  return centres
    .filter((one) => one.code !== except)
    .map((one) => ({ code: one.code, km: distanceKm(point, one.centre) }))
    .sort((a, b) => a.km - b.km || a.code.localeCompare(b.code))
    .slice(0, count);
}

export type PointPrecision = "gpsPoint" | "estimate" | "chatLocation";

// A point with no accuracy was shared in a chat.
export function precisionOf(accuracyM: number | null): PointPrecision {
  if (accuracyM === null) return "chatLocation";
  return accuracyM <= GEO.pointAccuracyM ? "gpsPoint" : "estimate";
}
