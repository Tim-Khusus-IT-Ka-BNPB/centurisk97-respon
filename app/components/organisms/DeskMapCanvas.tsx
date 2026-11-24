import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre runs its tile work in a web worker loaded from its own file; the bundle ships that file here.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef } from "react";
import { boundsOf, INDONESIA, type MapPoint, markerElement, popupElement, TILE_STYLE } from "../../lib/deskMap";
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
      for (const point of points)
        new maplibre.Marker({ element: markerElement(point, t) })
          .setLngLat([point.lon, point.lat])
          .setPopup(new maplibre.Popup({ offset: 18 }).setDOMContent(popupElement(point, t)))
          .addTo(map);
      const bounds = boundsOf(points);
      // The container may reach its final size after the map was made, so measure again on load
      // and only then fit the points.
      map.once("load", () => {
        map.resize();
        if (bounds !== null) map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 0 });
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
