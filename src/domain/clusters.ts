import { distanceKm, type Point } from "./geo";
import type { HazardTypeId } from "./hazards";
import type { TicketStatus } from "./stages";
import { HOUR_MS } from "./time";

// Reports close in place and time (upstream A9, D27 to D30). A cluster is reports of one hazard
// from at least two different numbers; their figures are never added up (D28), and it is never
// called verified.

type ClusterRule =
  | { readonly reach: "local"; readonly km: number; readonly hours: number }
  | { readonly reach: "regency"; readonly hours: number };

// Two reports of a local hazard in the same village join within this, even outside the hazard's own
// window; a cluster longer than the chain limit is cut at its widest gap (upstream LK-01, Q1, Q2,
// hypotheses until data says otherwise).
const VILLAGE_HOURS = 24;
const CHAIN_HOURS = 72;

// Drought and abrasion last for days and are not clustered until upstream Q18 is answered.
const CLUSTER_RULES: Partial<Record<HazardTypeId, ClusterRule>> = {
  flood: { reach: "local", km: 3, hours: 6 },
  landslide: { reach: "local", km: 3, hours: 6 },
  buildingFire: { reach: "local", km: 3, hours: 6 },
  extremeWeather: { reach: "local", km: 5, hours: 6 },
  forestFire: { reach: "local", km: 5, hours: 12 },
  earthquake: { reach: "regency", hours: 12 },
  volcanicEruption: { reach: "regency", hours: 12 },
  tsunami: { reach: "regency", hours: 12 },
};

export type ClusterInput = {
  readonly ticketNumber: string;
  readonly hazardType: string;
  // The GPS point, or null for a place picked by name.
  readonly point: Point | null;
  readonly villageCode: string;
  readonly regencyCode: string;
  // The event time, or the send time when the event time is not known.
  readonly atMs: number;
  readonly numberKey: string;
  // A photo placed by device GPS or by its own data.
  readonly placedPhoto: boolean;
  readonly status: TicketStatus;
};

export type Cluster = {
  // Oldest first.
  readonly tickets: readonly string[];
  readonly hazardType: string;
  readonly reporters: number;
  // Three reporters or more, or placed photos from two of them.
  readonly strong: boolean;
  // Joined only by the same-village rule: without it its reports fall apart (the desk's "satu desa").
  readonly sameVillage: boolean;
};

function near(a: ClusterInput, b: ClusterInput, rule: ClusterRule): boolean {
  if (a.hazardType !== b.hazardType || Math.abs(a.atMs - b.atMs) > rule.hours * HOUR_MS) return false;
  switch (rule.reach) {
    case "regency":
      return a.regencyCode === b.regencyCode;
    case "local":
      if (a.point && b.point && distanceKm(a.point, b.point) <= rule.km) return true;
      return a.villageCode === b.villageCode;
  }
}

function sameVillage(a: ClusterInput, b: ClusterInput, rule: ClusterRule): boolean {
  return (
    rule.reach === "local" &&
    a.hazardType === b.hazardType &&
    a.villageCode === b.villageCode &&
    Math.abs(a.atMs - b.atMs) <= VILLAGE_HOURS * HOUR_MS
  );
}

// Groups by union-find: each index points toward its group's root.
function groups(size: number) {
  const parent = Array.from({ length: size }, (_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : root(parent[index] as number));
  return { root, join: (i: number, j: number) => (parent[root(j)] = root(i)) };
}

// A group longer than the chain limit is cut at its widest gap in time, again until each part is short.
function cutChain(members: readonly ClusterInput[]): ClusterInput[][] {
  const sorted = [...members].sort((a, b) => a.atMs - b.atMs);
  if ((sorted.at(-1) as ClusterInput).atMs - (sorted[0] as ClusterInput).atMs <= CHAIN_HOURS * HOUR_MS) return [sorted];
  const gap = (i: number) => (sorted[i] as ClusterInput).atMs - (sorted[i - 1] as ClusterInput).atMs;
  let widest = 1;
  for (let i = 2; i < sorted.length; i++) if (gap(i) > gap(widest)) widest = i;
  return [...cutChain(sorted.slice(0, widest)), ...cutChain(sorted.slice(widest))];
}

// How long after a report of a hazard another one may still be of its event: its cluster window, or
// 72 hours for a hazard with no cluster rule (upstream JENDELA_JENIS_JAM).
export const sameEventHours = (hazardType: string): number => CLUSTER_RULES[hazardType as HazardTypeId]?.hours ?? 72;

// A reporter's own "the same event" joins two reports whatever the rules say; a cluster still needs
// two numbers.
export function clustersOf(
  reports: readonly ClusterInput[],
  links: readonly (readonly [string, string])[],
): readonly Cluster[] {
  const counted = reports.filter((report) => report.status !== "invalid");
  // Every rule, and the old rules alone, to tell a group the village rule alone holds together.
  const all = groups(counted.length);
  const old = groups(counted.length);
  counted.forEach((a, i) => {
    for (let j = i + 1; j < counted.length; j++) {
      const b = counted[j] as ClusterInput;
      const rule = CLUSTER_RULES[a.hazardType as HazardTypeId];
      if (rule === undefined) continue;
      if (near(a, b, rule)) {
        all.join(i, j);
        old.join(i, j);
      } else if (sameVillage(a, b, rule)) all.join(i, j);
    }
  });
  const indexOf = new Map(counted.map((report, index) => [report.ticketNumber, index]));
  for (const [a, b] of links) {
    const i = indexOf.get(a);
    const j = indexOf.get(b);
    if (i !== undefined && j !== undefined) {
      all.join(i, j);
      old.join(i, j);
    }
  }
  const byRoot = new Map<number, ClusterInput[]>();
  counted.forEach((report, index) => {
    byRoot.set(all.root(index), [...(byRoot.get(all.root(index)) ?? []), report]);
  });
  return [...byRoot.values()]
    .flatMap(cutChain)
    .filter((members) => new Set(members.map((member) => member.numberKey)).size >= 2)
    .sort((a, b) => (a[0] as ClusterInput).atMs - (b[0] as ClusterInput).atMs)
    .map((members) => {
      const reporters = new Set(members.map((member) => member.numberKey)).size;
      const photographers = new Set(members.filter((member) => member.placedPhoto).map((member) => member.numberKey))
        .size;
      const oldRoots = new Set(members.map((member) => old.root(indexOf.get(member.ticketNumber) as number)));
      return {
        tickets: members.map((member) => member.ticketNumber),
        hazardType: (members[0] as ClusterInput).hazardType,
        reporters,
        strong: reporters >= 3 || photographers >= 2,
        sameVillage: oldRoots.size > 1,
      };
    });
}

// Each ticket's cluster, for a ticket in one.
export function clusterOfTicket(clusters: readonly Cluster[]): ReadonlyMap<string, Cluster> {
  return new Map(clusters.flatMap((cluster) => cluster.tickets.map((ticket) => [ticket, cluster] as const)));
}
