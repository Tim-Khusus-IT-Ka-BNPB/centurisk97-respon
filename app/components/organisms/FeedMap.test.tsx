import { render, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { makeText } from "../../../src/copy/text";
import { TextContext } from "../../lib/text";
import { FEED_ALONE, FEED_ENTRY } from "../../testing/feed";
import { ALL_TEXTS } from "../../testing/render";
import { FeedMap } from "./FeedMap";

const made = vi.hoisted(() => ({ maps: [] as FakeMap[], markers: [] as FakeMarker[], noWebGl: false }));

class FakeMap {
  fitted: unknown[] = [];
  removed = false;
  styles: string[] = [];
  idle: (() => void) | null = null;
  load: (() => void) | null = null;
  constructor(readonly options: Record<string, unknown>) {
    if (made.noWebGl) throw new Error("WebGL2 is required to display this map");
    made.maps.push(this);
  }
  addControl() {}
  setStyle(style: string, options: { transformStyle(previous: undefined, next: unknown): unknown }) {
    this.styles.push(style);
    options.transformStyle(undefined, { layers: [] });
  }
  once(event: "idle" | "load", listener: () => void) {
    this[event] = listener;
  }
  resize() {}
  fitBounds(bounds: unknown, options: unknown) {
    this.fitted.push([bounds, options]);
  }
  remove() {
    this.removed = true;
  }
}
class FakeMarker {
  at: unknown = null;
  constructor(readonly options: { element: HTMLElement }) {
    made.markers.push(this);
  }
  setLngLat(at: unknown) {
    this.at = at;
    return this;
  }
  addTo() {
    return this;
  }
}

vi.mock("maplibre-gl", () => ({
  Map: FakeMap,
  Marker: FakeMarker,
  NavigationControl: class {},
  setWorkerUrl: () => {},
}));
vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?url", () => ({ default: "/assets/worker.mjs" }));

const draw = (entries = [FEED_ENTRY, FEED_ALONE]) =>
  render(
    <TextContext.Provider value={makeText(ALL_TEXTS)}>
      <FeedMap entries={entries} />
      <article id={`feed-${FEED_ENTRY.id}`} tabIndex={-1} />
    </TextContext.Provider>,
  );

describe("the feed map", () => {
  test("a marker per entry with a village centre, named in words, leading to its card", async () => {
    made.maps.length = 0;
    made.markers.length = 0;
    const view = draw();
    expect(view.getByRole("region", { name: "Peta kejadian yang ditangani" })).toBeTruthy();
    await waitFor(() => expect(made.maps).toHaveLength(1));
    const map = made.maps[0] as FakeMap;
    map.load?.();
    expect(made.markers.map((marker) => marker.at)).toEqual([[97.2, 5.1]]);
    const button = made.markers[0]?.options.element as HTMLButtonElement;
    expect(button.className).toBe("desk-marker desk-marker-done");
    expect(button.getAttribute("aria-label")).toBe("Banjir di Desa/Kel. Uji Satu, Selesai ditangani");
    const card = view.container.querySelector("article") as HTMLElement;
    card.scrollIntoView = vi.fn();
    button.click();
    expect(card.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(document.activeElement).toBe(card);
    expect(map.fitted).toEqual([
      [
        [
          [97.2, 5.1],
          [97.2, 5.1],
        ],
        { padding: 48, maxZoom: 11, duration: 0 },
      ],
    ]);
    map.idle?.();
    expect(view.getByRole("region").dataset.ready).toBe("true");
    document.documentElement.dataset.theme = "dark";
    await waitFor(() => expect(map.styles.at(-1)).toBe("https://tiles.openfreemap.org/styles/fiord"));
    document.documentElement.dataset.theme = "light";
    view.unmount();
    expect(map.removed).toBe(true);
  });

  test("with no village centre the map stays on Indonesia, and a card gone is no trouble", async () => {
    made.maps.length = 0;
    made.markers.length = 0;
    const view = draw([{ ...FEED_ALONE, id: "gone", centre: { lat: 1, lon: 1 } }, FEED_ALONE]);
    await waitFor(() => expect(made.maps).toHaveLength(1));
    const map = made.maps[0] as FakeMap;
    map.load?.();
    ((made.markers[0] as FakeMarker).options.element as HTMLButtonElement).click();
    view.unmount();
    made.maps.length = 0;
    const none = draw([FEED_ALONE]);
    await waitFor(() => expect(made.maps).toHaveLength(1));
    (made.maps[0] as FakeMap).load?.();
    expect((made.maps[0] as FakeMap).fitted).toEqual([]);
    none.unmount();
  });

  test("a browser with no WebGL2 is told the list still holds every entry", async () => {
    made.maps.length = 0;
    made.noWebGl = true;
    try {
      const view = draw();
      expect(
        await view.findByText("Peta tidak bisa ditampilkan di peramban ini. Daftar kejadian tetap lengkap."),
      ).toBeTruthy();
      expect(made.maps).toEqual([]);
      view.unmount();
    } finally {
      made.noWebGl = false;
    }
  });

  test("closed before the map arrives: nothing is made", async () => {
    made.maps.length = 0;
    draw().unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(made.maps).toEqual([]);
  });
});
