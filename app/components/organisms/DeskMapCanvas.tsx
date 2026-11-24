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
  INDONESIA,
  itemsIn,
  type MapPoint,
  markerElement,
  popupElement,
  TILE_STYLE,
} from "../../lib/deskMap";
import { useText } from "../../lib/text";

// The map itself, drawn in the browser only: MapLibre loads after the page, so the page and its
// table of points work with no script.
export function DeskMapCanvas({ points, label }: { readonly points: readonly MapPoint[]; readonly label: string }) {
  const t = useText();
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    let closed = false;
    let remove = () => {};
    const element = container.current as HTMLElement;
    import("maplibre-gl").then((maplibre) => {
      if (closed) return;
      maplibre.setWorkerUrl(workerUrl);
      const map = new maplibre.Map({
        container: element,
        style: TILE_STYLE,
        ...INDONESIA,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      // Set once the base map and markers have drawn, so a check or a picture waits for the tiles.
      map.once("idle", () => {
        element.dataset.ready = "true";
      });
      // Markers are drawn for the clusters and points in view, again after every zoom or pan.
      const index = clusterIndex(points);
      let drawn: { remove(): void }[] = [];
      const draw = () => {
        for (const marker of drawn) marker.remove();
        const box = map.getBounds();
        drawn = itemsIn(index, [box.getWest(), box.getSouth(), box.getEast(), box.getNorth()], map.getZoom()).map(
          (item) => {
            if (item.kind === "point")
              return new maplibre.Marker({ element: markerElement(item.point, t) })
                .setLngLat([item.point.lon, item.point.lat])
                .setPopup(new maplibre.Popup({ offset: 18 }).setDOMContent(popupElement(item.point, t)))
                .addTo(map);
            const button = clusterElement(item.count, item.tally, t);
            const zoom = index.getClusterExpansionZoom(item.id);
            const marker = new maplibre.Marker({ element: button }).setLngLat([item.lon, item.lat]);
            if (zoom > CLUSTER_MAX_ZOOM)
              marker.setPopup(
                new maplibre.Popup({ offset: 24 }).setDOMContent(
                  clusterList(
                    index.getLeaves(item.id, Number.POSITIVE_INFINITY).map((leaf) => leaf.properties),
                    t,
                  ),
                ),
              );
            else button.addEventListener("click", () => map.easeTo({ center: [item.lon, item.lat], zoom }));
            return marker.addTo(map);
          },
        );
      };
      map.on("moveend", draw);
      const bounds = boundsOf(points);
      // The container may reach its final size after the map was made, so measure again on load
      // and only then fit the points.
      map.once("load", () => {
        map.resize();
        if (bounds !== null) map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 0 });
        draw();
      });
      remove = () => map.remove();
    });
    return () => {
      closed = true;
      remove();
    };
  }, [points, t]);
  return (
    <section
      ref={container}
      aria-label={label}
      className="h-[60dvh] min-h-80 w-full overflow-hidden rounded-card border border-line"
    />
  );
}
