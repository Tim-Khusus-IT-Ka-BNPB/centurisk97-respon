import { type ClusterRow, recentReports } from "../adapters/d1/publicFeed";
import { type Cluster, type ClusterInput, clusterOfTicket, clustersOf } from "../domain/clusters";
import type { StaffScope } from "../domain/deskRights";
import { eventInstantMs } from "../domain/eventTime";
import type { EventTimeValue, PlaceValue } from "../domain/fieldState";
import { DAY_MS } from "../domain/time";
import { parsed } from "../platform/database";
import type { ServiceBindings } from "./bindings";

// Clusters are found among the reports of the last 30 days.
const CLUSTER_DAYS = 30;

type States = Record<string, { readonly state: string; readonly value?: unknown }>;

export function clusterInput(row: ClusterRow): ClusterInput {
  const states = parsed<States>(row.fields) as States;
  const place = (states.place as { readonly value: PlaceValue }).value;
  const eventTime = states.eventTime?.state === "value" ? (states.eventTime.value as EventTimeValue) : null;
  return {
    ticketNumber: row.ticket_number,
    hazardType: row.hazard_type,
    point: place.point ? { lat: place.point.lat, lon: place.point.lon } : null,
    villageCode: row.village_code,
    regencyCode: row.regency_code,
    atMs: (eventTime && eventInstantMs(eventTime)) ?? Date.parse(row.sent_at),
    numberKey: row.number_key,
    placedPhoto: row.placed_photo === 1,
    status: row.status,
  };
}

// Each ticket's cluster among the recent reports of a region, or of all.
export async function clusterMap(bindings: ServiceBindings, scope?: StaffScope): Promise<ReadonlyMap<string, Cluster>> {
  const since = new Date(bindings.clock.now() - CLUSTER_DAYS * DAY_MS);
  return clusterOfTicket(clustersOf((await recentReports(bindings.db, since, scope)).map(clusterInput)));
}
