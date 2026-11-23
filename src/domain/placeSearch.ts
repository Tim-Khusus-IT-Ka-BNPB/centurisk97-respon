import type { FieldError } from "./identityForm";
import { LENGTHS } from "./limits";

// How many places one answer lists: across the country, or inside a chosen regency or district.
export const PLACE_RESULTS = { country: 10, area: 40 } as const;

export type AreaLevel = "regency" | "district";

const AREA_CODES: Readonly<Record<AreaLevel, RegExp>> = {
  regency: /^\d{2}\.\d{2}$/,
  district: /^\d{2}\.\d{2}\.\d{2}$/,
};

// A regency code is "11.08", a district code "11.08.01"; anything else names no area.
export function areaLevelOf(code: string): AreaLevel | null {
  if (AREA_CODES.regency.test(code)) return "regency";
  if (AREA_CODES.district.test(code)) return "district";
  return null;
}

// A search across the country needs 3 to 60 characters; a filter inside an area may be empty.
export function checkPlaceQuery(query: string, insideArea: boolean): FieldError | null {
  const length = query.trim().length;
  if (length > LENGTHS.placeQuery.max) return { fieldId: "q", rule: "query.tooLong", params: {} };
  if (insideArea || length >= LENGTHS.placeQuery.min) return null;
  return { fieldId: "q", rule: "query.tooShort", params: {} };
}
