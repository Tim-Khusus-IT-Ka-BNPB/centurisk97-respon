import Supercluster from "supercluster";
import type { DeskMap } from "../../src/contract/desk";
import type { FeedEntry } from "../../src/contract/publicFeed";
import { hazardKey } from "../../src/copy/hazardKey";
import type { Text } from "../../src/copy/text";
import { ICONS, type IconName } from "../components/atoms/icons";
import { hazardIcon } from "./hazardIcons";

export type MapPoint = DeskMap["points"][number];

// The base map: OpenFreeMap's light style, as upstream's desk uses, and its dark one in the dark
// theme. No report data goes to it.
const dark = () => document.documentElement.dataset.theme === "dark";
export const tileStyle = () => `https://tiles.openfreemap.org/styles/${dark() ? "fiord" : "positron"}`;

type TileLayer = {
  readonly id: string;
  readonly type: string;
  readonly "source-layer"?: string;
  readonly layout?: Readonly<Record<string, unknown>>;
  readonly paint?: Readonly<Record<string, unknown>>;
};

const NAME = ["coalesce", ["get", "name:id"], ["get", "name:latin"], ["get", "name"]];
const GROUND = { light: { land: "#f4f6f9", water: "#cfe0f2" }, dark: { land: "#1b2a40", water: "#0d182a" } } as const;

// The base map in this site's colours, its places named in Indonesian or at least in Latin letters.
export function localStyle<S extends { readonly layers: readonly TileLayer[] }>(style: S): S {
  const ground = GROUND[dark() ? "dark" : "light"];
  const layers = style.layers.map((layer) => {
    if (layer.type === "background") return { ...layer, paint: { ...layer.paint, "background-color": ground.land } };
    if (layer.type === "fill" && layer["source-layer"] === "water")
      return { ...layer, paint: { ...layer.paint, "fill-color": ground.water } };
    const text = layer.layout?.["text-field"];
    // Road shields keep their number.
    return text === undefined || JSON.stringify(text).includes("ref")
      ? layer
      : { ...layer, layout: { ...layer.layout, "text-field": NAME } };
  });
  return { ...style, layers };
}

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
export function boundsOf(
  points: readonly { readonly lat: number; readonly lon: number }[],
): [[number, number], [number, number]] | null {
  if (points.length === 0) return null;
  const lons = points.map((point) => point.lon);
  const lats = points.map((point) => point.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

const SVG = "http://www.w3.org/2000/svg";

export function iconElement(name: IconName): SVGSVGElement {
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

// An emergency nobody has opened yet.
const alarming = (point: MapPoint) => point.emergency && point.status === "new";

// A point's marker: a button named in words, its hazard's icon inside, its status group as a class.
export function markerElement(point: MapPoint, t: Text): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  const alarm = alarming(point);
  button.className = `desk-marker desk-marker-${alarm ? "emergency" : STATUS_GROUPS[point.status]}`;
  button.setAttribute(
    "aria-label",
    t("desk.map.marker", {
      ticket: point.ticketNumber,
      hazard: point.emergency ? "desk.emergency.chip" : `hazard.${point.hazardType}.label`,
      status: `stage.short.${point.status}`,
    }),
  );
  button.appendChild(iconElement(alarm ? "triangleAlert" : hazardIcon(point.hazardType)));
  return button;
}

// The map button that brings every point back into view, beside the zoom buttons.
export function fitControl(t: Text, fit: () => void): { onAdd(): HTMLElement; onRemove(): void } {
  const group = document.createElement("div");
  group.className = "maplibregl-ctrl maplibregl-ctrl-group";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "desk-fit";
  button.title = t("desk.map.fit");
  button.setAttribute("aria-label", t("desk.map.fit"));
  button.appendChild(iconElement("scan"));
  button.addEventListener("click", fit);
  group.appendChild(button);
  return { onAdd: () => group, onRemove: () => group.remove() };
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
  line(t(hazardKey(point.hazardType)), "text-body font-bold");
  line(`${point.villageName}, ${t(`desk.map.precision.${point.precision}`)}`, "");
  line(`${point.ticketNumber}, ${t(`stage.short.${point.status}`)}`, "text-muted tabular-nums");
  const link = document.createElement("a");
  link.href = `/lapor/meja/${point.ticketNumber}`;
  link.className = "desk-popup-open";
  link.textContent = t("desk.map.open");
  box.appendChild(link);
  return box;
}

// Nearby points merge into one numbered circle, recomputed on every zoom and pan. A cluster
// counts its reports per status group; its ring shows the shares and its name says them.
type Group = (typeof GROUPS)[number];
// Its emergencies nobody has opened are counted too.
export type ClusterTally = Record<Group, number> & { alarm: number };

export type MapIndex = Supercluster<MapPoint, ClusterTally>;

// Past this zoom points are not merged any more.
export const CLUSTER_MAX_ZOOM = 16;

export function clusterIndex(points: readonly MapPoint[]): MapIndex {
  return new Supercluster<MapPoint, ClusterTally>({
    radius: 56,
    maxZoom: CLUSTER_MAX_ZOOM,
    map: (point) => ({
      open: 0,
      working: 0,
      done: 0,
      [STATUS_GROUPS[point.status]]: 1,
      alarm: alarming(point) ? 1 : 0,
    }),
    reduce: (into, from) => {
      into.alarm += from.alarm;
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
          tally: {
            open: properties.open,
            working: properties.working,
            done: properties.done,
            alarm: properties.alarm,
          },
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
  if (tally.alarm > 0) parts.unshift(t("desk.map.clusterPart.alarm", { count: tally.alarm }));
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
  if (tally.alarm > 0) {
    const mark = document.createElement("span");
    mark.className = "desk-cluster-alarm";
    mark.appendChild(iconElement("triangleAlert"));
    button.appendChild(mark);
  }
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
    const dot = document.createElement("span");
    dot.className = `desk-dot desk-dot-${STATUS_GROUPS[point.status]}`;
    dot.setAttribute("aria-hidden", "true");
    link.appendChild(dot);
    link.appendChild(
      document.createTextNode(
        `${point.ticketNumber}, ${t(hazardKey(point.hazardType))}, ${t(`stage.short.${point.status}`)}`,
      ),
    );
    item.appendChild(link);
    list.appendChild(item);
  }
  box.appendChild(list);
  return box;
}

// One point on the map: where it stands, how it is named in words, and the card it leads to.
export type MapMarker = {
  readonly anchor: string;
  readonly hazardType: string;
  readonly centre: { readonly lat: number; readonly lon: number } | null;
  readonly label: string;
  readonly group: "open" | "working" | "done";
};

export const feedMarkers = (entries: readonly FeedEntry[], t: Text): MapMarker[] =>
  entries.map((entry) => ({
    anchor: `feed-${entry.id}`,
    hazardType: entry.hazardType,
    centre: entry.centre,
    label: t("feed.map.marker", {
      hazard: hazardKey(entry.hazardType),
      village: entry.place.villageName,
      status: `feed.status.${entry.status}`,
    }),
    group: STATUS_GROUPS[entry.status],
  }));
