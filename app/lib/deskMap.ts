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
