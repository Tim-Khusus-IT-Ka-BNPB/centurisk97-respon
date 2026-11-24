import { cleanup, render, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { MapPoint } from "../../lib/deskMap";
import { makeText, TextContext } from "../../lib/text";
import { ALL_TEXTS } from "../../testing/render";
import { DeskMapCanvas } from "./DeskMapCanvas";

const made = vi.hoisted(() => ({ maps: [] as FakeMap[], markers: [] as FakeMarker[], workerUrl: "" }));

class FakeMap {
  controls: unknown[] = [];
  fitted: unknown[] = [];
  removed = false;
  constructor(readonly options: Record<string, unknown>) {
    made.maps.push(this);
  }
  addControl(control: unknown) {
    this.controls.push(control);
  }
  fitBounds(bounds: unknown, options: unknown) {
    this.fitted.push([bounds, options]);
  }
  remove() {
    this.removed = true;
  }
}
class FakeMarker {
  at: unknown = null;
  popup: { content: HTMLElement | null } | null = null;
  map: unknown = null;
  constructor(readonly options: { element: HTMLElement }) {
    made.markers.push(this);
  }
  setLngLat(at: unknown) {
    this.at = at;
    return this;
  }
  setPopup(popup: { content: HTMLElement | null }) {
    this.popup = popup;
    return this;
  }
  addTo(map: unknown) {
    this.map = map;
    return this;
  }
}

vi.mock("maplibre-gl", () => ({
  Map: FakeMap,
  Marker: FakeMarker,
  NavigationControl: class {},
  Popup: class {
    content: HTMLElement | null = null;
    setDOMContent(content: HTMLElement) {
      this.content = content;
      return this;
    }
  },
  setWorkerUrl: (url: string) => {
    made.workerUrl = url;
  },
}));
vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?url", () => ({ default: "/assets/worker.mjs" }));

const POINTS: MapPoint[] = [
  {
    ticketNumber: "LA-241126-01",
    status: "new",
    hazardType: "flood",
    villageName: "A",
    precision: "gpsPoint",
    lat: 5,
    lon: 97,
  },
  {
    ticketNumber: "LA-241126-02",
    status: "closed",
    hazardType: "flood",
    villageName: "B",
    precision: "villageLevel",
    lat: -8,
    lon: 131,
  },
];

const draw = (points: MapPoint[]) =>
  render(
    <TextContext.Provider value={makeText(ALL_TEXTS)}>
      <DeskMapCanvas points={points} label="Peta laporan" />
    </TextContext.Provider>,
  );

describe("the desk map canvas", () => {
  test("draws the base map, one marker with a popup per point, and fits them; closing removes it", async () => {
    const view = draw(POINTS);
    expect(view.getByRole("region", { name: "Peta laporan" })).toBeTruthy();
    await waitFor(() => expect(made.maps).toHaveLength(1));
    const map = made.maps[0] as FakeMap;
    expect(made.workerUrl).toBe("/assets/worker.mjs");
    expect(map.options).toMatchObject({
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [118, -2.5],
      attributionControl: { compact: true },
    });
    expect(map.controls).toHaveLength(1);
    expect(made.markers.map((marker) => marker.at)).toEqual([
      [97, 5],
      [131, -8],
    ]);
    expect(made.markers.every((marker) => marker.map === map)).toBe(true);
    expect(made.markers[0]?.popup?.content?.textContent).toContain("LA-241126-01");
    expect(map.fitted).toEqual([
      [
        [
          [97, -8],
          [131, 5],
        ],
        { padding: 48, maxZoom: 13, duration: 0 },
      ],
    ]);
    view.unmount();
    expect(map.removed).toBe(true);
  });

  test("with no points the map stays on Indonesia", async () => {
    made.maps.length = 0;
    draw([]);
    await waitFor(() => expect(made.maps).toHaveLength(1));
    expect((made.maps[0] as FakeMap).fitted).toEqual([]);
    cleanup();
  });

  test("closed before MapLibre arrives, nothing is drawn", async () => {
    made.maps.length = 0;
    draw(POINTS).unmount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(made.maps).toHaveLength(0);
    cleanup();
  });
});
