import type { HazardTypeId } from "../hazards";

// One answer of a choice question. Labels and notes live in the copy catalogue under
// option.<fieldId>.<optionId>. "meaning" marks an answer that is a none or a confirmed unknown
// rather than a value; such an answer is exclusive on a multiple choice question.
export type ChoiceOption = {
  readonly id: string;
  readonly value?: number;
  readonly meaning?: "none" | "unknown";
  readonly onlyFor?: readonly HazardTypeId[];
  readonly category?: "logistics" | "equipment" | "other";
  readonly freeTextMaxLength?: number;
};

const none = (id: string): ChoiceOption => ({ id, meaning: "none" });
const unknown: ChoiceOption = { id: "unknown", meaning: "unknown" };

// Hazards that usually displace people: shelter supplies are offered only for these.
const DISPLACING: readonly HazardTypeId[] = [
  "flood",
  "landslide",
  "tidalWaveAbrasion",
  "extremeWeather",
  "earthquake",
  "tsunami",
  "volcanicEruption",
  "buildingFire",
];

export const ROAD_PASSABLE = [
  { id: "allVehicles" },
  { id: "motorbikesAndWalkers" },
  { id: "cutOff" },
  unknown,
] as const satisfies readonly ChoiceOption[];

export const WATER_DEPTH = [
  { id: "ankle", value: 10 },
  { id: "knee", value: 50 },
  { id: "waist", value: 100 },
  { id: "chest", value: 130 },
  { id: "overHead", value: 170 },
] as const satisfies readonly ChoiceOption[];

export const BURNT_AREA = [
  { id: "underOneHectare" },
  { id: "oneToFiveHectares" },
  { id: "fiveToTwentyFiveHectares" },
  { id: "overTwentyFiveHectares" },
  unknown,
] as const satisfies readonly ChoiceOption[];

export const SHAKING_FELT = [
  { id: "barelyFelt" },
  { id: "feltNoDamage" },
  { id: "lightDamage" },
  { id: "moderateDamage" },
  { id: "heavyDamage" },
] as const satisfies readonly ChoiceOption[];

export const ASH_THICKNESS = [
  { id: "dustThin" },
  { id: "coinThick" },
  { id: "coversGround" },
  { id: "thick" },
] as const satisfies readonly ChoiceOption[];

export const SEA_WATER_HEIGHT = [
  { id: "ankle" },
  { id: "knee" },
  { id: "waist" },
  { id: "overHead" },
  unknown,
] as const satisfies readonly ChoiceOption[];

export const CLEAN_WATER = [
  { id: "stillEnough" },
  { id: "gettingHard" },
  { id: "noCleanWater" },
] as const satisfies readonly ChoiceOption[];

export const WIND_DAMAGE_SPREAD = [
  { id: "onePoint" },
  { id: "oneHamlet" },
  { id: "severalVillages" },
] as const satisfies readonly ChoiceOption[];

export const SHORELINE_LOSS = [
  { id: "underOneMetre" },
  { id: "oneToFiveMetres" },
  { id: "overFiveMetres" },
  unknown,
] as const satisfies readonly ChoiceOption[];

export const FARMLAND = [
  { id: "none", value: 0, meaning: "none" },
  { id: "underOneHectare", value: 0.5 },
  { id: "oneToTenHectares", value: 5 },
  { id: "tenToHundredHectares", value: 50 },
  { id: "overHundredHectares", value: 100 },
  unknown,
] as const satisfies readonly ChoiceOption[];

export const CRATER_DISTANCE = [
  { id: "underThreeKm", value: 2 },
  { id: "threeToFiveKm", value: 4 },
  { id: "fiveToTenKm", value: 7 },
  { id: "overTenKm", value: 10 },
  unknown,
] as const satisfies readonly ChoiceOption[];

export const VULNERABLE_GROUPS = [
  { id: "infantsToddlers" },
  { id: "pregnantOrNursing" },
  { id: "elderly" },
  { id: "disabled" },
  none("none"),
  unknown,
] as const satisfies readonly ChoiceOption[];

export const DISRUPTED_SERVICES = [
  { id: "powerOut" },
  { id: "phoneSignalLost" },
  { id: "cleanWaterStopped" },
  // K101: fuel, food and transport (Juklak Lampiran I 7.4, 7.5).
  { id: "fuelScarce" },
  { id: "marketsClosed" },
  { id: "transportClosed" },
  none("allRunning"),
  unknown,
] as const satisfies readonly ChoiceOption[];

const logistics = (id: string, onlyFor?: readonly HazardTypeId[]): ChoiceOption =>
  onlyFor ? { id, onlyFor, category: "logistics" } : { id, category: "logistics" };
const equipment = (id: string, onlyFor: readonly HazardTypeId[]): ChoiceOption => ({
  id,
  onlyFor,
  category: "equipment",
});

export const URGENT_NEEDS: readonly ChoiceOption[] = [
  logistics("readyMeals", [...DISPLACING, "forestFire"]),
  logistics("foodParcels"),
  logistics("drinkingWater"),
  logistics("clothingParcels", DISPLACING),
  logistics("sleepingMats", DISPLACING),
  logistics("tents", DISPLACING),
  logistics("familyKits", DISPLACING),
  logistics("babyKits", DISPLACING),
  logistics("medicalCare"),
  logistics("masks", ["forestFire", "volcanicEruption"]),
  equipment("rubberBoats", ["flood", "tsunami", "tidalWaveAbrasion"]),
  equipment("waterPumps", ["flood"]),
  equipment("waterTanks", ["drought"]),
  equipment("firefightingEquipment", ["forestFire", "buildingFire"]),
  equipment("sandbags", ["landslide", "flood", "tidalWaveAbrasion"]),
  equipment("heavyMachinery", ["landslide", "earthquake", "flood", "volcanicEruption", "tsunami"]),
  equipment("chainsaws", ["extremeWeather", "landslide"]),
  equipment("roofingMaterial", ["extremeWeather", "earthquake"]),
  equipment("generators", ["earthquake", "tsunami", "flood", "extremeWeather", "volcanicEruption"]),
  // K99: sanitation and light (Juklak Lampiran I 9.1, Perka 9/2008 Format-9).
  logistics("emergencyToilets", DISPLACING),
  equipment("lighting", ["forestFire", "buildingFire", "landslide", "tidalWaveAbrasion"]),
  { id: "other", category: "other", freeTextMaxLength: 120 },
  { id: "noUrgentNeed", category: "other", meaning: "none" },
];

// K94: someone still trapped or buried who needs rescue now.
export const TRAPPED = [
  { id: "seen" },
  { id: "heardOf" },
  none("noneKnown"),
  unknown,
] as const satisfies readonly ChoiceOption[];

// K98: serious injuries not yet treated, or many taken ill at once.
export const MEDICAL_HELP = [
  { id: "seriousInjuries" },
  { id: "suddenIllness" },
  { id: "both" },
  none("handled"),
  unknown,
] as const satisfies readonly ChoiceOption[];

// K95: how the event stands now.
export const CURRENT_STATE = [
  { id: "growing" },
  { id: "steady" },
  { id: "easing" },
  { id: "over" },
  unknown,
] as const satisfies readonly ChoiceOption[];

// K96: how officers and vehicles reach the place from the nearest main road.
export const SITE_ACCESS = [
  { id: "cars" },
  { id: "motorbikesOnly" },
  { id: "onFootOnly" },
  { id: "waterOrAir" },
  unknown,
] as const satisfies readonly ChoiceOption[];

// K102: residents threatened but not yet hit, in bands, never a count.
export const THREATENED_RESIDENTS = [
  { id: "fewHouses" },
  { id: "hamlet" },
  { id: "villages" },
  none("noneThreatened"),
  unknown,
] as const satisfies readonly ChoiceOption[];

// K102: residents who moved before the danger came, apart from the displaced.
export const MOVED_BEFORE = [
  { id: "many" },
  { id: "some" },
  none("noOrder"),
  unknown,
] as const satisfies readonly ChoiceOption[];

// K103: other hamlets cut off entirely.
export const ISOLATED_AREAS = [
  { id: "fullyCut" },
  { id: "roadCut" },
  none("noneCut"),
  unknown,
] as const satisfies readonly ChoiceOption[];

// K100: officers already on site.
export const OFFICERS_ON_SITE = [
  { id: "bpbd" },
  { id: "fireBrigade", onlyFor: ["buildingFire", "forestFire"] },
  { id: "sar", onlyFor: ["flood", "landslide", "earthquake", "tsunami", "volcanicEruption", "tidalWaveAbrasion"] },
  { id: "otherOfficers" },
  none("noneYet"),
  unknown,
] as const satisfies readonly ChoiceOption[];

// Options offered for this hazard type. An option tied to hazard types is hidden until the type is known.
export function applicableOptions(
  options: readonly ChoiceOption[],
  hazardType: HazardTypeId | null,
): readonly ChoiceOption[] {
  return options.filter((option) => !option.onlyFor || option.onlyFor.some((id) => id === hazardType));
}
