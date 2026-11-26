import {
  type ActiveSnapshot,
  type Area,
  activeSnapshot,
  areaOf,
  centresAround,
  outlinesAround,
  type PlaceHits,
  searchArea,
  searchCountry,
  villagesOf,
} from "../adapters/d1/places";
import type { PlacePoint, PlaceValue } from "../domain/fieldState";
import { GEO, inIndonesia, nearestCentres, precisionOf, resolveVillage } from "../domain/geo";
import { type AreaLevel, PLACE_RESULTS } from "../domain/placeSearch";
import { nearWords, placeQueryWords } from "../domain/placeText";
import type { LocateResult } from "../domain/turn/engine";
import { sqlState } from "../platform/database";
import type { ServiceBindings } from "./bindings";
import type { LimitRefusal } from "./limits";

// Counts the search against its limit; null lets it run.
export type Admit = () => Promise<LimitRefusal | null>;

// Similar: nothing held the words as typed, so these are places spelled close to them.
export type PlaceResults = PlaceHits & { readonly cut: boolean; readonly dataDate: string; readonly similar?: boolean };

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
    if (words.length === 0) return { kind: "ok", value: results({ items: [], total: 0 }, snapshot) };
    const hits = await searchCountry(bindings.db, snapshot.id, words, PLACE_RESULTS.country);
    if (hits.total > 0) return { kind: "ok", value: results(hits, snapshot) };
    // A slip of one letter or an old spelling still finds the village, said to be a close match.
    const near = await searchCountry(bindings.db, snapshot.id, words, PLACE_RESULTS.country, words.map(nearWords));
    return { kind: "ok", value: { ...results(near, snapshot), similar: near.total > 0 } };
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

// Centres within this square give the fallback village and the nearby list; with fewer than the
// list needs, a wider square is read once.
const CENTRE_WINDOW_DEG = 0.3;
const WIDE_WINDOW_DEG = 1;

// A GPS reading as a village of the active snapshot, with the villages nearest to it.
export async function locatePlace(bindings: ServiceBindings, reading: PlacePoint): Promise<LocateResult> {
  if (!inIndonesia(reading)) return { kind: "outside" };
  if (bindings.settings.faultPlace) return { kind: "unavailable" };
  try {
    const snapshot = await activeSnapshot(bindings.db);
    if (snapshot === null) return { kind: "unavailable" };
    const outlines = await outlinesAround(bindings.db, snapshot.id, reading);
    let centres = await centresAround(bindings.db, snapshot.id, reading, CENTRE_WINDOW_DEG);
    if (centres.length <= GEO.nearbyVillages)
      centres = await centresAround(bindings.db, snapshot.id, reading, WIDE_WINDOW_DEG);
    const resolved = resolveVillage(reading, outlines, centres);
    if (resolved === null) return { kind: "notFound" };
    const nearby = nearestCentres(reading, centres, GEO.nearbyVillages, resolved.code);
    const names = await villagesOf(bindings.db, snapshot.id, [resolved.code, ...nearby.map((one) => one.code)]);
    const precision = precisionOf(reading.accuracyM);
    const read = (code: string) => ({ ...(names.get(code) as PlaceValue), precision, point: reading });
    return {
      kind: "found",
      reading: {
        village: read(resolved.code),
        nearby: nearby.map((one) => ({ village: read(one.code), km: Math.round(one.km * 10) / 10 })),
      },
    };
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
