import Supercluster from "supercluster";
import type { DeskMap } from "../../src/contract/desk";
import { ICONS, type IconName } from "../components/atoms/icons";
import { HAZARD_ICONS } from "./hazardIcons";
import type { Text } from "./text";

export type MapPoint = DeskMap["points"][number];

// The base map: OpenFreeMap's light style, as upstream's desk uses. No report data goes to it.
export const TILE_STYLE = "https://tiles.openfreemap.org/styles/positron";
export const INDONESIA = { center: [118, -2.5] as [number, number], zoom: 3.6 };

// Seven statuses read as three groups on a map, each by colour and by its ring, with a legend in words.
export const STATUS_GROUPS = {
  new: "open",
  seen: "open",
  under_review: "working",
  forwarded: "working",
  in_handling: "working",
  closed: "done",
  invalid: "done",
} as const;

export const GROUPS = ["open", "working", "done"] as const;

// The box holding every point, as [[west, south], [east, north]], or null with no points.
export function boundsOf(points: readonly MapPoint[]): [[number, number], [number, number]] | null {
  if (points.length === 0) return null;
  const lons = points.map((point) => point.lon);
  const lats = points.map((point) => point.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

const SVG = "http://www.w3.org/2000/svg";

function iconElement(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    svg.setAttribute(key, value);
  for (const [tag, attributes] of ICONS[name]) {
    const part = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) part.setAttribute(key, String(value));
    svg.appendChild(part);
  }
  return svg;
}

// A point's marker: a button named in words, its hazard's icon inside, its status group as a class.
export function markerElement(point: MapPoint, t: Text): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `desk-marker desk-marker-${STATUS_GROUPS[point.status]}`;
  button.setAttribute(
    "aria-label",
    t("desk.map.marker", {
      ticket: point.ticketNumber,
      hazard: `hazard.${point.hazardType}.label`,
      status: `stage.short.${point.status}`,
    }),
  );
  button.appendChild(iconElement(HAZARD_ICONS[point.hazardType] as IconName));
  return button;
}

// A point's popup: what it is and the way to the report. Text only, never markup from data.
export function popupElement(point: MapPoint, t: Text): HTMLElement {
  const box = document.createElement("div");
  box.className = "desk-popup";
  const line = (text: string, className: string) => {
    const element = document.createElement("p");
    element.className = className;
    element.textContent = text;
    box.appendChild(element);
  };
  line(point.ticketNumber, "font-bold tabular-nums");
  line(`${t(`hazard.${point.hazardType}.label`)}, ${t(`stage.short.${point.status}`)}`, "");
  line(`${point.villageName}, ${t(`desk.map.precision.${point.precision}`)}`, "text-meta");
  const link = document.createElement("a");
  link.href = `/lapor/meja/${point.ticketNumber}`;
  link.textContent = t("desk.map.open");
  box.appendChild(link);
  return box;
}

// Nearby points merge into one numbered circle, recomputed on every zoom and pan. A cluster
// counts its reports per status group; its ring shows the shares and its name says them.
type Group = (typeof GROUPS)[number];
export type ClusterTally = Record<Group, number>;

export type MapIndex = Supercluster<MapPoint, ClusterTally>;

// Past this zoom points are not merged any more.
export const CLUSTER_MAX_ZOOM = 16;

export function clusterIndex(points: readonly MapPoint[]): MapIndex {
  return new Supercluster<MapPoint, ClusterTally>({
    radius: 56,
    maxZoom: CLUSTER_MAX_ZOOM,
    map: (point) => ({ open: 0, working: 0, done: 0, [STATUS_GROUPS[point.status]]: 1 }),
    reduce: (into, from) => {
      for (const group of GROUPS) into[group] += from[group];
    },
  }).load(
    points.map((point) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [point.lon, point.lat] },
      properties: point,
    })),
  );
}

export type MapItem =
  | { readonly kind: "point"; readonly point: MapPoint }
  | {
      readonly kind: "cluster";
      readonly id: number;
      readonly count: number;
      readonly tally: ClusterTally;
      readonly lon: number;
      readonly lat: number;
    };

// What to draw in this view: [west, south, east, north] at a whole zoom level.
export function itemsIn(index: MapIndex, bounds: [number, number, number, number], zoom: number): MapItem[] {
  return index.getClusters(bounds, Math.floor(zoom)).map((feature) => {
    const [lon, lat] = feature.geometry.coordinates as [number, number];
    const properties = feature.properties;
    return "cluster" in properties && properties.cluster === true
      ? {
          kind: "cluster",
          id: properties.cluster_id,
          count: properties.point_count,
          tally: { open: properties.open, working: properties.working, done: properties.done },
          lon,
          lat,
        }
      : { kind: "point", point: properties as MapPoint };
  });
}

// A cluster: a button with its count inside a ring split by status group in the legend's colours,
// named in words with each group's count, a little larger from ten reports.
export function clusterElement(count: number, tally: ClusterTally, t: Text): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `desk-cluster${count >= 10 ? " desk-cluster-large" : ""}`;
  const parts = GROUPS.filter((group) => tally[group] > 0).map((group) =>
    t(`desk.map.clusterPart.${group}`, { count: tally[group] }),
  );
  button.setAttribute("aria-label", t("desk.map.cluster", { count, parts: parts.join(", ") }));
  const ring = document.createElementNS(SVG, "svg");
  ring.setAttribute("viewBox", "0 0 44 44");
  ring.setAttribute("aria-hidden", "true");
  // Each group is an arc of the same circle: its length is its share, starting where the last ended.
  const circumference = 2 * Math.PI * 19;
  let start = 0;
  for (const group of GROUPS) {
    if (tally[group] === 0) continue;
    const length = (tally[group] / count) * circumference;
    const arc = document.createElementNS(SVG, "circle");
    for (const [key, value] of Object.entries({
      cx: "22",
      cy: "22",
      r: "19",
      class: `desk-ring desk-ring-${group}`,
      "stroke-dasharray": `${length} ${circumference - length}`,
      "stroke-dashoffset": String(-start),
    }))
      arc.setAttribute(key, value);
    ring.appendChild(arc);
    start += length;
  }
  button.appendChild(ring);
  const number = document.createElement("span");
  number.textContent = String(count);
  button.appendChild(number);
  return button;
}

// Reports at one spot (village-level places share their village's centre) cannot be pulled apart
// by zooming, so their cluster opens as a list instead.
export function clusterList(points: readonly MapPoint[], t: Text): HTMLElement {
  const box = document.createElement("div");
  box.className = "desk-popup";
  const title = document.createElement("p");
  title.className = "font-bold";
  title.textContent = t("desk.map.clusterList", { count: points.length });
  box.appendChild(title);
  const list = document.createElement("ul");
  list.className = "desk-popup-list";
  for (const point of points) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `/lapor/meja/${point.ticketNumber}`;
    link.textContent = `${point.ticketNumber}, ${t(`hazard.${point.hazardType}.label`)}, ${t(`stage.short.${point.status}`)}`;
    item.appendChild(link);
    list.appendChild(item);
  }
  box.appendChild(list);
  return box;
}
