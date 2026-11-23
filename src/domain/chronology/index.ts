import type { HazardTypeId } from "../hazards";
import { DROUGHT, EARTHQUAKE, FOREST_FIRE } from "./dryAndFire";
import { BUILDING_FIRE, TSUNAMI, VOLCANIC_ERUPTION } from "./seaVolcanoBuilding";
import type { ChronologyStep } from "./step";
import { EXTREME_WEATHER, FLOOD, LANDSLIDE, TIDAL_WAVE_ABRASION } from "./waterAndWeather";

export type { ChronologyStep } from "./step";
export { isExclusive } from "./step";

// The legacy type "other" has no guided steps: its chronology is typed freely.
const STEPS: Readonly<Record<HazardTypeId, readonly ChronologyStep[]>> = {
  flood: FLOOD,
  landslide: LANDSLIDE,
  tidalWaveAbrasion: TIDAL_WAVE_ABRASION,
  extremeWeather: EXTREME_WEATHER,
  drought: DROUGHT,
  forestFire: FOREST_FIRE,
  earthquake: EARTHQUAKE,
  tsunami: TSUNAMI,
  volcanicEruption: VOLCANIC_ERUPTION,
  buildingFire: BUILDING_FIRE,
  other: [],
};

export function chronologySteps(hazardType: HazardTypeId): readonly ChronologyStep[] {
  return STEPS[hazardType];
}
