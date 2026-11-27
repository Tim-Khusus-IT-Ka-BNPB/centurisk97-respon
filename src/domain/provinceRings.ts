// Upstream's map per province (row 27): zoomed out, a ring for each province with a slice for each
// hazard, sized by how many events it holds, standing at the middle of their points.
export type RingItem = {
  readonly provinceName: string;
  readonly hazardType: string;
  readonly point: { readonly lat: number; readonly lon: number } | null;
};

export type ProvinceRing = {
  readonly provinceName: string;
  readonly point: { readonly lat: number; readonly lon: number };
  readonly total: number;
  // The most first; ties in hazard order as given.
  readonly slices: readonly { readonly hazardType: string; readonly count: number }[];
};

// A province with no point among its items has nowhere to stand, and is left off the map.
export function provinceRings(items: readonly RingItem[]): readonly ProvinceRing[] {
  return [...Map.groupBy(items, (item) => item.provinceName)].flatMap(([provinceName, mine]) => {
    const placed = mine.flatMap((item) => (item.point === null ? [] : [item.point]));
    if (placed.length === 0) return [];
    const mean = (pick: (point: { lat: number; lon: number }) => number) =>
      placed.reduce((sum, point) => sum + pick(point), 0) / placed.length;
    const counts = [...Map.groupBy(mine, (item) => item.hazardType)].map(([hazardType, of]) => ({
      hazardType,
      count: of.length,
    }));
    return [
      {
        provinceName,
        point: { lat: mean((point) => point.lat), lon: mean((point) => point.lon) },
        total: mine.length,
        slices: counts.sort((a, b) => b.count - a.count),
      },
    ];
  });
}
