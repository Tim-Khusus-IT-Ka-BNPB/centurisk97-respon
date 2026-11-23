// Hazard types and their subtypes, in the order the reporter sees them. Labels live in the copy
// catalogue under hazard.<id> and hazardSubtype.<id>.<subtypeId>.
const HAZARD_SUBTYPES = {
  flood: ["riverOverflow", "standingWater", "flashFlood", "tidalFlood", "laharFlood", "embankmentFailure"],
  landslide: ["slide", "rockfall", "debrisFlow", "slowCreep"],
  tidalWaveAbrasion: ["tidalWave", "coastalAbrasion"],
  extremeWeather: ["whirlwind", "strongWind", "tropicalCyclone", "hail", "extremeTemperature"],
  drought: ["meteorological", "agricultural", "hydrological"],
  forestFire: ["forest", "nonPeatLand", "peatLand"],
  earthquake: ["tectonic", "volcanic", "collapse"],
  tsunami: ["seismic", "nonSeismic"],
  volcanicEruption: ["collapsePyroclasticFlow", "eruptionPyroclasticFlow", "ashfall", "toxicGas", "incandescentEjecta"],
  buildingFire: ["building", "settlement"],
  other: ["otherEvent"],
} as const satisfies Record<string, readonly string[]>;

export type HazardTypeId = keyof typeof HAZARD_SUBTYPES;

export const HAZARD_TYPE_IDS = Object.keys(HAZARD_SUBTYPES) as HazardTypeId[];

// "other" stays readable on old reports but is never offered as a choice.
export const SELECTABLE_HAZARD_TYPES: readonly HazardTypeId[] = HAZARD_TYPE_IDS.filter((id) => id !== "other");

// Every subtype question also offers "Tidak tahu", stored as this value.
const SUBTYPE_UNKNOWN = "unknown";

export function isHazardTypeId(value: unknown): value is HazardTypeId {
  return Object.hasOwn(HAZARD_SUBTYPES, value as string);
}

export function isSelectableHazardType(value: unknown): value is HazardTypeId {
  return isHazardTypeId(value) && value !== "other";
}

export function subtypeChoices(hazardType: HazardTypeId): readonly string[] {
  return [...HAZARD_SUBTYPES[hazardType], SUBTYPE_UNKNOWN];
}

export function isSubtypeOf(hazardType: HazardTypeId, subtype: unknown): boolean {
  return subtypeChoices(hazardType).some((id) => id === subtype);
}
