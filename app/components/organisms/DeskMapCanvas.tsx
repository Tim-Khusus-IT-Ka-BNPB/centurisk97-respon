import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre runs its tile work in a web worker loaded from its own file; the bundle ships that file here.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef } from "react";
import {
  boundsOf,
  CLUSTER_MAX_ZOOM,
  clusterElement,
  clusterIndex,
  clusterList,
  fitControl,
  INDONESIA,
  itemsIn,
  localStyle,
  type MapPoint,
  markerElement,
  popupElement,
  tileStyle,
} from "../../lib/deskMap";
import { useText } from "../../lib/text";

// Room for the filters floating over the top of a wide map and the buttons at its right.
const WIDE = { padding: { top: 96, bottom: 56, left: 48, right: 96 }, maxZoom: 13 } as const;
// A small map on a page of its own: the point in its middle, and the towns around it.
export const SMALL = { padding: 48, maxZoom: 11 } as const;
const NOBODY = () => {};

// The map itself, drawn in the browser only: MapLibre loads after the page, so the page and its
// lists work with no script.
export function DeskMapCanvas({
  points,
  label,
  pointed = null,
  onView = NOBODY,
  framing = WIDE,
}: {
  readonly points: readonly MapPoint[];
  readonly label: string;
  // The ticket pointed at beside the map: its marker, or the cluster holding it, stands out.
  readonly pointed?: string | null;
  // The tickets in view, after every zoom or pan.
  readonly onView?: (tickets: ReadonlySet<string>) => void;
  // How close the points are framed; one of the two above.
  readonly framing?: typeof WIDE | typeof SMALL;
}) {
  const t = useText();
  const container = useRef<HTMLElement>(null);
  // What is drawn for each ticket in view.
  const holders = useRef(new Map<string, HTMLElement>());
  // The map is made once and kept while the filters change, so it reads the latest of these.
  const latest = useRef({ points, t });
  latest.current = { points, t };
  const show = useRef<(() => void) | null>(null);
  useEffect(() => {
    let closed = false;
    let remove = () => {};
    const element = container.current as HTMLElement;
    import("maplibre-gl").then((maplibre) => {
      if (closed) return;
      maplibre.setWorkerUrl(workerUrl);
      const map = new maplibre.Map({
        container: element,
        ...INDONESIA,
        attributionControl: { compact: true },
      });
      const paint = () => map.setStyle(tileStyle(), { transformStyle: (_previous, next) => localStyle(next) });
      paint();
      const frame = (duration: number) => {
        const bounds = boundsOf(latest.current.points);
        if (bounds !== null) map.fitBounds(bounds, { ...framing, duration });
      };
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(
        fitControl(latest.current.t, () => frame(400)),
        "bottom-right",
      );
      // Set once the base map and markers have drawn, so a check or a picture waits for the tiles.
      map.once("idle", () => {
        element.dataset.ready = "true";
      });
      // The base map follows the page's theme.
      const theme = new MutationObserver(paint);
      theme.observe(document.documentElement, { attributeFilter: ["data-theme"] });
      // Markers are drawn for the clusters and points in view, again after every zoom or pan.
      let index = clusterIndex([]);
      let drawn: { remove(): void }[] = [];
      const draw = () => {
        const { t } = latest.current;
        for (const marker of drawn) marker.remove();
        holders.current = new Map();
        const box = map.getBounds();
        drawn = itemsIn(index, [box.getWest(), box.getSouth(), box.getEast(), box.getNorth()], map.getZoom()).map(
          (item) => {
            if (item.kind === "point") {
              const button = markerElement(item.point, t);
              holders.current.set(item.point.ticketNumber, button);
              return new maplibre.Marker({ element: button })
                .setLngLat([item.point.lon, item.point.lat])
                .setPopup(new maplibre.Popup({ offset: 18 }).setDOMContent(popupElement(item.point, t)))
                .addTo(map);
            }
            const button = clusterElement(item.count, item.tally, t);
            const inside = index.getLeaves(item.id, Number.POSITIVE_INFINITY).map((leaf) => leaf.properties);
            for (const point of inside) holders.current.set(point.ticketNumber, button);
            const zoom = index.getClusterExpansionZoom(item.id);
            const marker = new maplibre.Marker({ element: button }).setLngLat([item.lon, item.lat]);
            if (zoom > CLUSTER_MAX_ZOOM)
              marker.setPopup(new maplibre.Popup({ offset: 24 }).setDOMContent(clusterList(inside, t)));
            else button.addEventListener("click", () => map.easeTo({ center: [item.lon, item.lat], zoom }));
            return marker.addTo(map);
          },
        );
        onView(new Set(holders.current.keys()));
      };
      map.on("moveend", draw);
      const showPoints = (duration: number) => {
        index = clusterIndex(latest.current.points);
        frame(duration);
        draw();
      };
      // The container may reach its final size after the map was made, so measure again on load
      // and only then fit the points.
      map.once("load", () => {
        map.resize();
        showPoints(0);
        show.current = () => showPoints(400);
      });
      remove = () => {
        theme.disconnect();
        map.remove();
      };
    });
    return () => {
      closed = true;
      show.current = null;
      remove();
    };
  }, [onView, framing]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: new points are read through the ref.
  useEffect(() => show.current?.(), [points]);
  useEffect(() => {
    const holder = pointed === null ? undefined : holders.current.get(pointed);
    holder?.classList.add("desk-pointed");
    return () => holder?.classList.remove("desk-pointed");
  }, [pointed]);
  // MapLibre positions its own element, so the frame around it fills the space.
  return (
    <div className="absolute inset-0">
      <section ref={container} aria-label={label} className="size-full" />
    </div>
  );
}
