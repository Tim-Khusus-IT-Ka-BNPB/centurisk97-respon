import {
  type ActiveSnapshot,
  type Area,
  activeSnapshot,
  areaOf,
  type PlaceHits,
  searchArea,
  searchCountry,
} from "../adapters/d1/places";
import { type AreaLevel, PLACE_RESULTS } from "../domain/placeSearch";
import { placeQueryWords } from "../domain/placeText";
import { sqlState } from "../platform/database";
import type { ServiceBindings } from "./bindings";
import type { LimitRefusal } from "./limits";

// Counts the search against its limit; null lets it run.
export type Admit = () => Promise<LimitRefusal | null>;

export type PlaceResults = PlaceHits & { readonly cut: boolean; readonly dataDate: string };

export type AreaResults = PlaceResults & { readonly area: Area };

export type PlaceAnswer<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "noArea" }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal }
  // No valid snapshot, the fault flag, or the database failing: search cannot be offered now.
  | { readonly kind: "unavailable" };

const results = (hits: PlaceHits, snapshot: ActiveSnapshot): PlaceResults => ({
  ...hits,
  cut: hits.total > hits.items.length,
  dataDate: snapshot.dataDate,
});

// Any database failure, the limit counter's included, means search cannot be offered now.
async function withSnapshot<T>(
  bindings: ServiceBindings,
  admit: Admit,
  work: (snapshot: ActiveSnapshot) => Promise<PlaceAnswer<T>>,
): Promise<PlaceAnswer<T>> {
  if (bindings.settings.faultPlace) return { kind: "unavailable" };
  try {
    const refusal = await admit();
    if (refusal) return { kind: "limit", refusal };
    const snapshot = await activeSnapshot(bindings.db);
    return snapshot === null ? { kind: "unavailable" } : await work(snapshot);
  } catch (error) {
    const state = sqlState(error);
    bindings.log.error({
      event: "place.failed",
      errorCode: "place.unavailable",
      ...(state ? { sqlState: state } : {}),
    });
    return { kind: "unavailable" };
  }
}

// Regencies, districts and villages across the country that hold every typed word.
export function searchPlaces(
  bindings: ServiceBindings,
  query: string,
  admit: Admit,
): Promise<PlaceAnswer<PlaceResults>> {
  return withSnapshot<PlaceResults>(bindings, admit, async (snapshot) => {
    const words = placeQueryWords(query);
    const hits =
      words.length === 0
        ? { items: [], total: 0 }
        : await searchCountry(bindings.db, snapshot.id, words, PLACE_RESULTS.country);
    return { kind: "ok", value: results(hits, snapshot) };
  });
}

// The villages of one regency or district, filtered by the typed words.
export function areaVillages(
  bindings: ServiceBindings,
  level: AreaLevel,
  code: string,
  query: string,
  admit: Admit,
): Promise<PlaceAnswer<AreaResults>> {
  return withSnapshot<AreaResults>(bindings, admit, async (snapshot) => {
    const area = await areaOf(bindings.db, snapshot.id, level, code);
    if (area === null) return { kind: "noArea" };
    const hits = await searchArea(bindings.db, snapshot.id, area, placeQueryWords(query), PLACE_RESULTS.area);
    return { kind: "ok", value: { ...results(hits, snapshot), area } };
  });
}
