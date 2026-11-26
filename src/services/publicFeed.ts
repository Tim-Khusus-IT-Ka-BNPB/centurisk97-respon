import { markProof, publicProofKey, publicProofs, type ShownRow, shownReports } from "../adapters/d1/publicFeed";
import type { Feed, FeedEntry } from "../contract/publicFeed";
import type { EventTimeValue, PlaceValue } from "../domain/fieldState";
import { impactOf } from "../domain/impact";
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
const PROOFS = 4;

export type FeedFilter = { readonly hazardType: string | null; readonly provinceCode: string | null };

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

export type FeedAnswer =
  | { readonly kind: "ok"; readonly feed: Feed }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// What is being handled, for anyone. One entry per cluster, told by its newest handled report.
export async function publicFeed(bindings: ServiceBindings, address: string, filter: FeedFilter): Promise<FeedAnswer> {
  const refusal = await checkLimits(bindings, [["address.feed", { kind: "address", bucket: address }]]);
  if (refusal) return { kind: "limit", refusal };
  const [shown, clusterOf, proofs] = await Promise.all([
    shownReports(bindings.db, filter),
    clusterMap(bindings),
    publicProofs(bindings.db),
  ]);
  const standing = new Map<string, ShownRow>();
  for (const row of shown) {
    const key = clusterOf.get(row.ticket_number)?.tickets[0] ?? row.ticket_number;
    if (!standing.has(key)) standing.set(key, row);
  }
  const entries = await Promise.all(
    [...standing.entries()].slice(0, ENTRIES).map(async ([key, row]) => {
      const cluster = clusterOf.get(row.ticket_number);
      const members = new Set(cluster?.tickets ?? [row.ticket_number]);
      const id = (await hmacKey(bindings.settings.keyHmacSecret, "feed", key)).slice(0, 16);
      const own = proofs.filter((proof) => members.has(proof.ticket_number)).map((proof) => proof.id);
      return entryOf(row, id, cluster?.reporters ?? null, own);
    }),
  );
  return { kind: "ok", feed: { entries } };
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
