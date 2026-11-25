import type { IconName } from "../components/atoms/icons";

// One line icon per hazard type, the same on the choice tiles and the desk map.
export const HAZARD_ICONS: Readonly<Record<string, IconName>> = {
  flood: "droplets",
  landslide: "mountain",
  tidalWaveAbrasion: "shell",
  extremeWeather: "tornado",
  drought: "sun",
  forestFire: "trees",
  earthquake: "activity",
  tsunami: "waves",
  volcanicEruption: "mountainSnow",
  buildingFire: "flame",
};

// The desk also lists old reports of the legacy "other" type, which has no icon of its own.
export const hazardIcon = (id: string): IconName => HAZARD_ICONS[id] ?? "circleHelp";
