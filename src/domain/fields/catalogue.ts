import type { HazardTypeId } from "../hazards";
import {
  ASH_THICKNESS,
  BURNT_AREA,
  type ChoiceOption,
  CLEAN_WATER,
  CRATER_DISTANCE,
  DISRUPTED_SERVICES,
  FARMLAND,
  ROAD_PASSABLE,
  SEA_WATER_HEIGHT,
  SHAKING_FELT,
  SHORELINE_LOSS,
  URGENT_NEEDS,
  VULNERABLE_GROUPS,
  WATER_DEPTH,
  WIND_DAMAGE_SPREAD,
} from "./options";

// Groups in the order the reporter is asked. Labels and prompts live under group.<id>.
export const GROUP_IDS = [
  "event",
  "victims",
  "affected",
  "displacement",
  "houses",
  "vulnerable",
  "facilities",
  "services",
  "specific",
  "needs",
] as const;
export type GroupId = (typeof GROUP_IDS)[number];

type CountUnit = "people" | "families" | "houses" | "units" | "points";

type Scope = {
  readonly id: string;
  readonly group: GroupId;
  readonly required?: true;
  // Asked only when this field holds a count above 0.
  readonly parent?: string;
  readonly onlyFor?: readonly HazardTypeId[];
  readonly exceptFor?: readonly HazardTypeId[];
};

export type FieldDefinition =
  | (Scope & { readonly kind: "place" | "neighbourhood" | "hazardType" | "hazardSubtype" | "eventTime" })
  | (Scope & { readonly kind: "chronology"; readonly noteMaxLength: number; readonly maxLength: number })
  | (Scope & { readonly kind: "count"; readonly unit: CountUnit; readonly max: number })
  | (Scope & { readonly kind: "text"; readonly maxLength: number })
  | (Scope & { readonly kind: "choice"; readonly unit?: "cm" | "ha" | "km"; readonly options: readonly ChoiceOption[] })
  | (Scope & { readonly kind: "multiChoice"; readonly options: readonly ChoiceOption[] });

const NOT_FOR_DROUGHT: readonly HazardTypeId[] = ["drought"];
const NO_ROADS: readonly HazardTypeId[] = ["forestFire", "drought", "buildingFire"];

// The binding field table, in the order fields are asked. Labels, definitions and questions
// live in the copy catalogue under field.<id>.
export const FIELDS = [
  { id: "place", group: "event", kind: "place", required: true },
  { id: "neighbourhood", group: "event", kind: "neighbourhood" },
  { id: "hazardType", group: "event", kind: "hazardType", required: true },
  { id: "hazardSubtype", group: "event", kind: "hazardSubtype", required: true },
  { id: "chronology", group: "event", kind: "chronology", required: true, noteMaxLength: 300, maxLength: 500 },
  { id: "eventTime", group: "event", kind: "eventTime", required: true },
  { id: "dead", group: "victims", kind: "count", unit: "people", max: 100_000 },
  { id: "missing", group: "victims", kind: "count", unit: "people", max: 100_000 },
  { id: "injured", group: "victims", kind: "count", unit: "people", max: 1_000_000 },
  { id: "injuredInpatient", group: "victims", kind: "count", unit: "people", max: 1_000_000, parent: "injured" },
  { id: "affectedFamilies", group: "affected", kind: "count", unit: "families", max: 5_000_000 },
  { id: "affectedPeople", group: "affected", kind: "count", unit: "people", max: 20_000_000 },
  { id: "displacedPeople", group: "displacement", kind: "count", unit: "people", max: 5_000_000 },
  { id: "displacedFamilies", group: "displacement", kind: "count", unit: "families", max: 2_000_000 },
  { id: "shelters", group: "displacement", kind: "text", maxLength: 300, parent: "displacedPeople" },
  { id: "housesHeavy", group: "houses", kind: "count", unit: "houses", max: 2_000_000, exceptFor: NOT_FOR_DROUGHT },
  {
    id: "housesModerate",
    group: "houses",
    kind: "count",
    unit: "houses",
    max: 2_000_000,
    exceptFor: NOT_FOR_DROUGHT,
  },
  { id: "housesLight", group: "houses", kind: "count", unit: "houses", max: 2_000_000, exceptFor: NOT_FOR_DROUGHT },
  {
    id: "housesFlooded",
    group: "houses",
    kind: "count",
    unit: "houses",
    max: 5_000_000,
    onlyFor: ["flood", "tsunami", "tidalWaveAbrasion"],
  },
  { id: "vulnerableGroups", group: "vulnerable", kind: "multiChoice", options: VULNERABLE_GROUPS },
  { id: "schools", group: "facilities", kind: "count", unit: "units", max: 100_000, exceptFor: NOT_FOR_DROUGHT },
  {
    id: "healthFacilities",
    group: "facilities",
    kind: "count",
    unit: "units",
    max: 100_000,
    exceptFor: NOT_FOR_DROUGHT,
  },
  { id: "worshipPlaces", group: "facilities", kind: "count", unit: "units", max: 100_000, exceptFor: NOT_FOR_DROUGHT },
  { id: "roads", group: "facilities", kind: "count", unit: "points", max: 100_000, exceptFor: NO_ROADS },
  { id: "schoolNames", group: "facilities", kind: "text", maxLength: 300, parent: "schools" },
  { id: "healthFacilityNames", group: "facilities", kind: "text", maxLength: 300, parent: "healthFacilities" },
  { id: "worshipPlaceNames", group: "facilities", kind: "text", maxLength: 300, parent: "worshipPlaces" },
  { id: "roadNames", group: "facilities", kind: "text", maxLength: 300, parent: "roads" },
  { id: "roadPassable", group: "facilities", kind: "choice", options: ROAD_PASSABLE, parent: "roads" },
  { id: "disruptedServices", group: "services", kind: "multiChoice", options: DISRUPTED_SERVICES },
  { id: "waterDepth", group: "specific", kind: "choice", unit: "cm", options: WATER_DEPTH, onlyFor: ["flood"] },
  { id: "burntArea", group: "specific", kind: "choice", unit: "ha", options: BURNT_AREA, onlyFor: ["forestFire"] },
  { id: "shakingFelt", group: "specific", kind: "choice", options: SHAKING_FELT, onlyFor: ["earthquake"] },
  { id: "ashThickness", group: "specific", kind: "choice", options: ASH_THICKNESS, onlyFor: ["volcanicEruption"] },
  { id: "seaWaterHeight", group: "specific", kind: "choice", options: SEA_WATER_HEIGHT, onlyFor: ["tsunami"] },
  { id: "cleanWater", group: "specific", kind: "choice", options: CLEAN_WATER, onlyFor: ["drought"] },
  {
    id: "windDamageSpread",
    group: "specific",
    kind: "choice",
    options: WIND_DAMAGE_SPREAD,
    onlyFor: ["extremeWeather"],
  },
  {
    id: "shorelineLoss",
    group: "specific",
    kind: "choice",
    options: SHORELINE_LOSS,
    onlyFor: ["tidalWaveAbrasion"],
  },
  {
    id: "farmland",
    group: "specific",
    kind: "choice",
    unit: "ha",
    options: FARMLAND,
    onlyFor: ["flood", "landslide", "drought", "volcanicEruption", "extremeWeather", "tsunami", "tidalWaveAbrasion"],
  },
  {
    id: "craterDistance",
    group: "specific",
    kind: "choice",
    unit: "km",
    options: CRATER_DISTANCE,
    onlyFor: ["volcanicEruption"],
  },
  { id: "urgentNeeds", group: "needs", kind: "multiChoice", options: URGENT_NEEDS },
] as const satisfies readonly FieldDefinition[];

export type FieldId = (typeof FIELDS)[number]["id"];

const BY_ID: ReadonlyMap<string, FieldDefinition> = new Map(FIELDS.map((field) => [field.id, field]));

export function isFieldId(value: unknown): value is FieldId {
  return BY_ID.has(value as string);
}

export function fieldById(id: FieldId): FieldDefinition {
  return BY_ID.get(id) as FieldDefinition;
}
