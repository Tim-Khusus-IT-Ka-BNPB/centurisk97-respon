import type { FacilityFile, FacilityKind } from "./facilities";
import { FACILITY_KINDS } from "./facilities";
import { distanceKm, type Point } from "./geo";

export type NearFacility = {
  readonly kind: FacilityKind;
  readonly name: string;
  readonly phone: string;
  // Straight-line distance, to one decimal.
  readonly km: number;
};

// Two of each kind at most, each within 30 km, nearest first; the kinds in upstream's order.
export const NEAR = { perKind: 2, maxKm: 30 } as const;

// Stryker disable next-line EqualityOperator: a place exactly 30 km away is not writable in floats
const within = (km: number) => km <= NEAR.maxKm;

export function nearestFacilities(file: FacilityFile, from: Point): readonly NearFacility[] {
  const near = file.fasilitas
    .map(([kind, lat, lon, name, phone]) => ({ kind, name, phone, km: distanceKm(from, { lat, lon }) }))
    .filter((one) => within(one.km))
    .sort((a, b) => a.km - b.km);
  return FACILITY_KINDS.flatMap((kind) =>
    near
      .filter((one) => one.kind === kind)
      .slice(0, NEAR.perKind)
      .map((one) => ({ ...one, km: Math.round(one.km * 10) / 10 })),
  );
}
