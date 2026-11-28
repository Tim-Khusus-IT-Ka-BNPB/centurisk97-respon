import { type ClusterRow, recentLinks, recentReports } from "../adapters/postgres/publicFeed";
import { type Cluster, type ClusterInput, clusterOfTicket, clustersOf } from "../domain/clusters";
import type { StaffScope } from "../domain/deskRights";
import { eventInstantMs } from "../domain/eventTime";
import type { EventTimeValue, PlaceValue } from "../domain/fieldState";
import { DAY_MS } from "../domain/time";
import type { ServiceBindings } from "./bindings";

// Clusters are found among the reports of the last 30 days.
const CLUSTER_DAYS = 30;

type States = Record<string, { readonly state: string; readonly value?: unknown }>;

export function clusterInput(row: ClusterRow): ClusterInput {
  const states = row.fields as States | null as States;
  // A row written by hand may hold no place; it is still placed by its village.
  const place = states.place?.state === "value" ? (states.place.value as PlaceValue) : null;
  const eventTime = states.eventTime?.state === "value" ? (states.eventTime.value as EventTimeValue) : null;
  return {
    ticketNumber: row.ticket_number,
    hazardType: row.hazard_type,
    point: place?.point ? { lat: place.point.lat, lon: place.point.lon } : null,
    villageCode: row.village_code,
    regencyCode: row.regency_code,
    atMs: (eventTime && eventInstantMs(eventTime)) ?? Date.parse(row.sent_at),
    numberKey: row.number_key,
    placedPhoto: row.placed_photo === true,
    status: row.status,
  };
}

// Each ticket's cluster among the recent reports of a region, or of all.
export async function clusterMap(bindings: ServiceBindings, scope?: StaffScope): Promise<ReadonlyMap<string, Cluster>> {
  const since = new Date(bindings.clock.now() - CLUSTER_DAYS * DAY_MS);
  const [reports, links] = await Promise.all([
    recentReports(bindings.db, since, scope),
    recentLinks(bindings.db, since),
  ]);
  return clusterOfTicket(clustersOf(reports.map(clusterInput), links));
}
