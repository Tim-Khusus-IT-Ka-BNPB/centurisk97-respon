import { provinceNames } from "../adapters/d1/places";
import { markProof, publicProofKey, publicProofs, type ShownRow, shownReports } from "../adapters/d1/publicFeed";
import { referenceFile } from "../adapters/d1/reports";
import type { Feed, FeedEntry, Official, Watch } from "../contract/publicFeed";
import type { Cluster } from "../domain/clusters";
import { type FeedPeriod, feedSince } from "../domain/feedPeriod";
import type { EventTimeValue, PlaceValue } from "../domain/fieldState";
import { checkForecastFile, warningsOf } from "../domain/forecast";
import { impactOf } from "../domain/impact";
import { checkKabarFile, officialEvents } from "../domain/officialEvents";
import { checkVolcanoFile, volcanoSummary } from "../domain/volcano";
import { parsed } from "../platform/database";
import { hmacKey } from "../platform/keys";
import type { StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { clusterMap } from "./clusters";
import { changeTicket, type DeskChange } from "./desk";
import { at, draftZone } from "./draftView";
import { checkLimits, type LimitRefusal } from "./limits";

// The feed shows the newest 100 entries.
const ENTRIES = 100;
// Everyone sees the same feed, so one read serves a data centre's readers for a minute.
const FEED_SECONDS = 60;
const PROOFS = 4;

export type FeedFilter = {
  readonly hazardType: string | null;
  readonly provinceCode: string | null;
  readonly period: FeedPeriod;
};

type States = Record<string, { readonly state: string; readonly value?: unknown }>;

const fieldValue = <T>(states: States, field: string): T | null => {
  const state = states[field];
  return state?.state === "value" ? (state.value as T) : null;
};

const rounded = (degrees: number) => Math.round(degrees * 1e4) / 1e4;

export function entryOf(row: ShownRow, id: string, reporters: number | null, proofs: readonly string[]): FeedEntry {
  const states = parsed<States>(row.fields) as States;
  const place = fieldValue<PlaceValue>(states, "place") as PlaceValue;
  const subtype = fieldValue<string>(states, "hazardSubtype");
  return {
    id,
    hazardType: row.hazard_type as FeedEntry["hazardType"],
    hazardSubtype: subtype === "unknown" ? null : subtype,
    status: row.status as FeedEntry["status"],
    place: {
      villageName: place.villageName,
      districtName: place.districtName,
      regencyName: place.regencyName,
      provinceName: place.provinceName,
    },
    centre:
      row.centre_lat === null || row.centre_lon === null
        ? null
        : { lat: rounded(row.centre_lat), lon: rounded(row.centre_lon) },
    eventTime: fieldValue<EventTimeValue>(states, "eventTime"),
    sentAt: at(Date.parse(row.sent_at), draftZone(row.village_code)),
    impact: impactOf(states),
    reporters,
    proofs: proofs.slice(0, PROOFS),
  };
}

// One card per cluster, told by its newest handled report; the rows come newest first.
function standingOf(shown: readonly ShownRow[], clusterOf: ReadonlyMap<string, Cluster>): Map<string, ShownRow> {
  const standing = new Map<string, ShownRow>();
  for (const row of shown) {
    const key = clusterOf.get(row.ticket_number)?.tickets[0] ?? row.ticket_number;
    if (!standing.has(key)) standing.set(key, row);
  }
  return standing;
}

// A card's id: made from its cluster's first ticket, so it names no ticket.
const cardIdOf = async (bindings: ServiceBindings, key: string) =>
  (await hmacKey(bindings.settings.keyHmacSecret, "feed", key)).slice(0, 16);

export type ShownCard = {
  readonly cardId: string;
  readonly tickets: readonly string[];
  // The report whose values the card shows.
  readonly ticketNumber: string;
};

// Every card the Alun-alun shows now, of every kind and time.
export async function shownCards(bindings: ServiceBindings): Promise<ShownCard[]> {
  const [shown, clusterOf] = await Promise.all([
    shownReports(bindings.db, { hazardType: null, provinceCode: null }),
    clusterMap(bindings),
  ]);
  return Promise.all(
    [...standingOf(shown, clusterOf).entries()].slice(0, ENTRIES).map(async ([key, row]) => ({
      cardId: await cardIdOf(bindings, key),
      tickets: clusterOf.get(row.ticket_number)?.tickets ?? [row.ticket_number],
      ticketNumber: row.ticket_number,
    })),
  );
}

export type FeedAnswer =
  | { readonly kind: "ok"; readonly feed: Feed }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// What is being handled, for anyone. One entry per cluster, told by its newest handled report.
export async function publicFeed(bindings: ServiceBindings, address: string, filter: FeedFilter): Promise<FeedAnswer> {
  const refusal = await checkLimits(bindings, [["address.feed", { kind: "address", bucket: address }]]);
  if (refusal) return { kind: "limit", refusal };
  const key = `feed?hazard=${filter.hazardType ?? ""}&province=${filter.provinceCode ?? ""}&period=${filter.period}`;
  const kept = await bindings.edge.get(key);
  if (kept !== null) return { kind: "ok", feed: JSON.parse(kept) as Feed };
  const [shown, clusterOf, proofs] = await Promise.all([
    shownReports(bindings.db, filter),
    clusterMap(bindings),
    publicProofs(bindings.db),
  ]);
  const since = feedSince(filter.period, bindings.clock.now(), shown[0] ? Date.parse(shown[0].sent_at) : null);
  const standing = standingOf(
    shown.filter((one) => since === null || Date.parse(one.sent_at) >= since),
    clusterOf,
  );
  const entries = await Promise.all(
    [...standing.entries()].slice(0, ENTRIES).map(async ([key, row]) => {
      const cluster = clusterOf.get(row.ticket_number);
      const members = new Set(cluster?.tickets ?? [row.ticket_number]);
      const id = await cardIdOf(bindings, key);
      const own = proofs.filter((proof) => members.has(proof.ticket_number)).map((proof) => proof.id);
      return entryOf(row, id, cluster?.reporters ?? null, own);
    }),
  );
  const feed = { entries };
  await bindings.edge.put(key, JSON.stringify(feed), FEED_SECONDS);
  return { kind: "ok", feed };
}

export type FeedProofAnswer =
  | { readonly kind: "file"; readonly bytes: Uint8Array }
  | { readonly kind: "notFound" }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// A photo of the work an officer marked public, of a report the feed shows.
export async function feedProof(bindings: ServiceBindings, address: string, proofId: string): Promise<FeedProofAnswer> {
  const refusal = await checkLimits(bindings, [["address.feed", { kind: "address", bucket: address }]]);
  if (refusal) return { kind: "limit", refusal };
  const key = await publicProofKey(bindings.db, proofId);
  const bytes = key === null ? null : await bindings.photos.get(key);
  return bytes === null ? { kind: "notFound" } : { kind: "file", bytes };
}

// An officer shows a photo of the work on the feed, or takes it off.
export function markProofPublic(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
  proofId: string,
  shown: boolean,
): Promise<DeskChange> {
  return changeTicket(bindings, staff, "addHandling", ticketNumber, async (_found, at) =>
    (await markProof(bindings.db, staff, ticketNumber, proofId, shown, at)) ? null : { kind: "notFound" },
  );
}

export type WatchAnswer =
  | { readonly kind: "ok"; readonly watch: Watch }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// What is on watch, for anyone: the outlook's regencies at Waspada or above, and the volcanoes at
// Siaga or Awas, each from its upstream file as imported.
export async function watchView(bindings: ServiceBindings, address: string): Promise<WatchAnswer> {
  const refusal = await checkLimits(bindings, [["address.feed", { kind: "address", bucket: address }]]);
  if (refusal) return { kind: "limit", refusal };
  const [forecast, volcanoes] = await Promise.all([
    referenceFile(bindings.db, "forecast").then(checkForecastFile),
    referenceFile(bindings.db, "volcanoes").then(checkVolcanoFile),
  ]);
  return {
    kind: "ok",
    watch: {
      forecast:
        forecast === null
          ? null
          : {
              madeAt: forecast.dibuat,
              regencies: warningsOf(forecast).map((one) => ({ ...one, threats: [...one.threats] })),
            },
      volcanoes:
        volcanoes === null ? null : { ...volcanoSummary(volcanoes), raised: [...volcanoSummary(volcanoes).raised] },
    },
  };
}

export type OfficialAnswer =
  | { readonly kind: "ok"; readonly official: Official }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// BNPB's daily report on the Alun-alun, as upstream gathered it with its news (row 26).
export async function officialView(bindings: ServiceBindings, address: string): Promise<OfficialAnswer> {
  const refusal = await checkLimits(bindings, [["address.feed", { kind: "address", bucket: address }]]);
  if (refusal) return { kind: "limit", refusal };
  const [file, provinces] = await Promise.all([
    referenceFile(bindings.db, "officialEvents").then(checkKabarFile),
    provinceNames(bindings.db),
  ]);
  return {
    kind: "ok",
    official:
      file === null
        ? { day: null, events: [] }
        : {
            day: file.hari,
            events: officialEvents(file).map((one) => ({
              ...one,
              provinceName: provinces.get(one.provinceCode) ?? null,
              hazardType: one.hazardType as Official["events"][number]["hazardType"],
              news: [...one.news],
            })),
          },
  };
}
