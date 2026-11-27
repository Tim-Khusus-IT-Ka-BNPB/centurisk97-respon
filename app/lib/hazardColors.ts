// One colour per hazard for the map's province rings, and its class for the legend's dot; the
// ring's label says the counts in words, so the colour only repeats them.
const COLORS: Readonly<Record<string, readonly [hex: string, dot: string]>> = {
  flood: ["#2563eb", "bg-[#2563eb]"],
  landslide: ["#a16207", "bg-[#a16207]"],
  extremeWeather: ["#0891b2", "bg-[#0891b2]"],
  earthquake: ["#7c3aed", "bg-[#7c3aed]"],
  buildingFire: ["#dc2626", "bg-[#dc2626]"],
  forestFire: ["#ea580c", "bg-[#ea580c]"],
  drought: ["#ca8a04", "bg-[#ca8a04]"],
  volcanicEruption: ["#be123c", "bg-[#be123c]"],
  tsunami: ["#0e7490", "bg-[#0e7490]"],
  tidalWaveAbrasion: ["#0284c7", "bg-[#0284c7]"],
};
const OTHER = ["#64748b", "bg-[#64748b]"] as const;

const colorOf = (id: string) => COLORS[id] ?? OTHER;
export const hazardDot = (id: string) => colorOf(id)[1];

// The ring's slices as a conic gradient, each hazard's share of the circle.
export function ringGradient(slices: readonly { readonly hazardType: string; readonly count: number }[]): string {
  const total = slices.reduce((sum, one) => sum + one.count, 0);
  let from = 0;
  const stops = slices.map((one) => {
    const to = from + (one.count / total) * 360;
    const stop = `${colorOf(one.hazardType)[0]} ${from}deg ${to}deg`;
    from = to;
    return stop;
  });
  return `conic-gradient(${stops.join(", ")})`;
}
