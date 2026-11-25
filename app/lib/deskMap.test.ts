import { describe, expect, test, vi } from "vitest";
import { text } from "../testing/render";
import {
  boundsOf,
  CLUSTER_MAX_ZOOM,
  type ClusterTally,
  clusterElement,
  clusterIndex,
  clusterList,
  fitControl,
  itemsIn,
  localStyle,
  type MapPoint,
  markerElement,
  popupElement,
  STATUS_GROUPS,
} from "./deskMap";

const POINT: MapPoint = {
  ticketNumber: "LA-241126-01",
  status: "seen",
  hazardType: "flood",
  villageName: "Sukamaju",
  precision: "villageLevel",
  emergency: false,
  lat: 5.1,
  lon: 97.1,
};

describe("desk map pieces", () => {
  test("the box around the points, and none without points", () => {
    expect(boundsOf([POINT, { ...POINT, lat: -8.2, lon: 131.5 }, { ...POINT, lat: -2, lon: 110 }])).toEqual([
      [97.1, -8.2],
      [131.5, 5.1],
    ]);
    expect(boundsOf([])).toBeNull();
  });

  test("the base map takes this site's colours and Indonesian names; road shields keep their number", () => {
    const style = {
      version: 8,
      layers: [
        { id: "ground", type: "background", paint: { "background-opacity": 1 } },
        { id: "sea", type: "fill", "source-layer": "water", paint: {} },
        { id: "park", type: "fill", "source-layer": "park", paint: { "fill-color": "green" } },
        { id: "town", type: "symbol", layout: { "text-field": ["get", "name_en"], "text-size": 12 } },
        { id: "road", type: "symbol", layout: { "text-field": "{ref}" } },
      ],
    };
    const [ground, sea, park, town, road] = localStyle(style).layers;
    expect(ground?.paint).toEqual({ "background-opacity": 1, "background-color": "#f4f6f9" });
    expect(sea?.paint).toEqual({ "fill-color": "#cfe0f2" });
    expect([park, road]).toEqual([style.layers[2], style.layers[4]]);
    expect(town?.layout).toEqual({
      "text-field": ["coalesce", ["get", "name:id"], ["get", "name:latin"], ["get", "name"]],
      "text-size": 12,
    });
    expect(localStyle(style)).toMatchObject({ version: 8 });
    document.documentElement.dataset.theme = "dark";
    expect(localStyle(style).layers[1]?.paint).toEqual({ "fill-color": "#0d182a" });
    delete document.documentElement.dataset.theme;
  });

  test("every status belongs to one of three groups", () => {
    expect(STATUS_GROUPS).toEqual({
      new: "open",
      seen: "open",
      under_review: "working",
      forwarded: "working",
      in_handling: "working",
      closed: "done",
      invalid: "done",
    });
  });

  test("a marker is a named button with its hazard's icon and its status group", () => {
    const marker = markerElement(POINT, text);
    expect(marker.tagName).toBe("BUTTON");
    expect(marker.type).toBe("button");
    expect(marker.className).toBe("desk-marker desk-marker-open");
    expect(marker.getAttribute("aria-label")).toBe("LA-241126-01, Banjir, Dilihat");
    const svg = marker.querySelector("svg") as SVGSVGElement;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(markerElement({ ...POINT, status: "closed", hazardType: "earthquake" }, text).className).toContain(
      "desk-marker-done",
    );
  });

  test("an emergency nobody has opened stands out on the map; opened, it is marked by its status", () => {
    const alarm = markerElement({ ...POINT, status: "new", emergency: true }, text);
    expect(alarm.className).toBe("desk-marker desk-marker-emergency");
    expect(alarm.getAttribute("aria-label")).toBe("LA-241126-01, Darurat, Diterima");
    expect(markerElement({ ...POINT, emergency: true }, text).className).toBe("desk-marker desk-marker-open");
  });

  test("the show-all button is named and leaves with the map", () => {
    const fit = vi.fn();
    const control = fitControl(text, fit);
    const group = control.onAdd();
    document.body.appendChild(group);
    const button = group.querySelector("button") as HTMLButtonElement;
    expect(button.getAttribute("aria-label")).toBe("Tampilkan semua titik");
    button.click();
    expect(fit).toHaveBeenCalledTimes(1);
    control.onRemove();
    expect(group.isConnected).toBe(false);
  });

  test("a popup holds the ticket, type and status, the village with its precision, and the way to the report", () => {
    const popup = popupElement({ ...POINT, villageName: "<b>Sukamaju</b>" }, text);
    expect([...popup.querySelectorAll("p")].map((line) => line.textContent)).toEqual([
      "Banjir",
      "<b>Sukamaju</b>, perkiraan tingkat desa",
      "LA-241126-01, Dilihat",
    ]);
    // One tap told no hazard.
    expect(popupElement({ ...POINT, hazardType: "other" }, text).textContent).toContain("Jenis belum diketahui");
    expect(popup.querySelector("b")).toBeNull();
    const link = popup.querySelector("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/lapor/meja/LA-241126-01");
    expect(link.textContent).toBe("Buka laporan");
  });
});

describe("clusters", () => {
  const near = (n: number, status: MapPoint["status"]): MapPoint => ({
    ...POINT,
    ticketNumber: `LA-241126-0${n}`,
    status,
    lat: 5.1 + n * 0.001,
    lon: 97.1,
  });
  const WORLD: [number, number, number, number] = [-180, -85, 180, 85];

  test("near points merge far out and come apart close in; a lone point stays a point", () => {
    const index = clusterIndex([
      near(1, "closed"),
      near(2, "under_review"),
      near(3, "closed"),
      { ...POINT, lat: -8, lon: 131 },
    ]);
    const far = itemsIn(index, WORLD, 4.7);
    const cluster = far.find((item) => item.kind === "cluster");
    expect(cluster).toMatchObject({ kind: "cluster", count: 3, tally: { open: 0, working: 1, done: 2, alarm: 0 } });
    expect(far.filter((item) => item.kind === "point")).toHaveLength(1);
    expect(itemsIn(index, WORLD, CLUSTER_MAX_ZOOM).every((item) => item.kind === "point")).toBe(true);
  });

  test("a cluster counts its reports per status group", () => {
    const tallyOf = (statuses: MapPoint["status"][]) =>
      (itemsIn(clusterIndex(statuses.map((status, n) => near(n, status))), WORLD, 3)[0] as { tally: unknown }).tally;
    expect(tallyOf(["closed", "new", "in_handling", "seen"])).toEqual({ open: 2, working: 1, done: 1, alarm: 0 });
    expect(tallyOf(["closed", "invalid"])).toEqual({ open: 0, working: 0, done: 2, alarm: 0 });
  });

  test("points at one spot never split, so the index says they expand past the last zoom", () => {
    const index = clusterIndex([POINT, { ...POINT, ticketNumber: "LA-241126-02" }]);
    const [only] = itemsIn(index, WORLD, CLUSTER_MAX_ZOOM);
    expect(only?.kind).toBe("cluster");
    expect(index.getClusterExpansionZoom((only as { id: number }).id)).toBeGreaterThan(CLUSTER_MAX_ZOOM);
  });

  test("a cluster button names its count per group and draws each group's share of the ring", () => {
    const button = clusterElement(4, { open: 1, working: 0, done: 3, alarm: 0 }, text);
    expect(button.textContent).toBe("4");
    expect(button.type).toBe("button");
    expect(button.className).toBe("desk-cluster");
    expect(button.getAttribute("aria-label")).toBe(
      "4 laporan berdekatan: 1 belum ditangani, 3 ditutup. Ketuk untuk memperbesar.",
    );
    const arcs = [...button.querySelectorAll("circle")];
    const full = 2 * Math.PI * 19;
    expect(arcs.map((arc) => arc.getAttribute("class"))).toEqual([
      "desk-ring desk-ring-open",
      "desk-ring desk-ring-done",
    ]);
    expect(arcs.map((arc) => arc.getAttribute("stroke-dasharray"))).toEqual([
      `${full / 4} ${full - full / 4}`,
      `${(full * 3) / 4} ${full - (full * 3) / 4}`,
    ]);
    expect(arcs.map((arc) => arc.getAttribute("stroke-dashoffset"))).toEqual(["0", String(-full / 4)]);
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(clusterElement(10, { open: 0, working: 10, done: 0, alarm: 0 }, text).className).toBe(
      "desk-cluster desk-cluster-large",
    );
  });

  test("a cluster holding emergencies nobody has opened is marked and says so", () => {
    const points = [near(1, "new"), { ...near(2, "new"), emergency: true }, { ...near(3, "seen"), emergency: true }];
    const [only] = itemsIn(clusterIndex(points), WORLD, 3) as { count: number; tally: ClusterTally }[];
    expect(only?.tally).toEqual({ open: 3, working: 0, done: 0, alarm: 1 });
    const button = clusterElement(3, only?.tally as ClusterTally, text);
    expect(button.getAttribute("aria-label")).toBe(
      "3 laporan berdekatan: 1 darurat belum dibuka, 3 belum ditangani. Ketuk untuk memperbesar.",
    );
    expect(button.querySelectorAll(".desk-cluster-alarm svg")).toHaveLength(1);
    const calm = clusterElement(1, { open: 1, working: 0, done: 0, alarm: 0 }, text);
    expect(calm.querySelector(".desk-cluster-alarm")).toBeNull();
  });

  test("a same-spot list links every report with its type and status", () => {
    const list = clusterList([POINT, { ...POINT, ticketNumber: "LA-241126-02", status: "closed" }], text);
    expect(list.querySelector("p")?.textContent).toBe("2 laporan di titik yang sama");
    expect([...list.querySelectorAll("a")].map((link) => [link.getAttribute("href"), link.textContent])).toEqual([
      ["/lapor/meja/LA-241126-01", "LA-241126-01, Banjir, Dilihat"],
      ["/lapor/meja/LA-241126-02", "LA-241126-02, Banjir, Selesai"],
    ]);
  });
});
