import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef, useState } from "react";
import { hazardKey } from "../../../src/copy/hazardKey";
import type { ProvinceRing } from "../../../src/domain/provinceRings";
import { cn } from "../../lib/cn";
import { boundsOf, INDONESIA, iconElement, localStyle, type MapMarker, tileStyle } from "../../lib/deskMap";
import { hazardDot, ringGradient } from "../../lib/hazardColors";
import { hazardIcon } from "../../lib/hazardIcons";
import { useText } from "../../lib/text";

type Placed = MapMarker & { readonly centre: NonNullable<MapMarker["centre"]> };

// Zoomed out past this, a ring per province stands in for the points (upstream's map, row 27).
const RING_ZOOM = 6;
const ringSize = (total: number) => 34 + Math.min(total, 20) * 2;

// The feed on a map, drawn in the browser only: the list beside it works with no script. Each
// marker stands at its village's centre and leads to its card; zoomed out, a ring per province.
export function FeedMap({
  markers,
  rings = [],
  label = "feed.map.label",
}: {
  readonly markers: readonly MapMarker[];
  readonly rings?: readonly ProvinceRing[];
  readonly label?: string;
}) {
  const t = useText();
  const container = useRef<HTMLElement>(null);
  const latest = useRef({ markers, rings, t });
  latest.current = { markers, rings, t };
  // A browser with no WebGL2 cannot draw it: the list beside it still holds every entry.
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let closed = false;
    let remove = () => {};
    import("maplibre-gl").then((maplibre) => {
      if (closed) return;
      maplibre.setWorkerUrl(workerUrl);
      const element = container.current as HTMLElement;
      let map: InstanceType<typeof maplibre.Map>;
      try {
        map = new maplibre.Map({ container: element, ...INDONESIA, attributionControl: { compact: true } });
      } catch {
        setFailed(true);
        return;
      }
      const paint = () => map.setStyle(tileStyle(), { transformStyle: (_previous, next) => localStyle(next) });
      paint();
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      const theme = new MutationObserver(paint);
      theme.observe(document.documentElement, { attributeFilter: ["data-theme"] });
      map.once("idle", () => {
        element.dataset.ready = "true";
      });
      map.once("load", () => {
        map.resize();
        const { markers: all, rings: provinces, t: text } = latest.current;
        const placed = all.filter((marker): marker is Placed => marker.centre !== null);
        const points: HTMLElement[] = [];
        const circles: HTMLElement[] = [];
        for (const ring of provinces) {
          const circle = document.createElement("div");
          circle.className = "feed-ring";
          circle.setAttribute("role", "img");
          circle.setAttribute(
            "aria-label",
            text("feed.map.ring", {
              province: ring.provinceName,
              total: ring.total,
              parts: ring.slices
                .map((one) => `${one.count} ${text(hazardKey(one.hazardType)).toLowerCase()}`)
                .join(", "),
            }),
          );
          circle.style.setProperty("--ring", ringGradient(ring.slices));
          circle.style.width = circle.style.height = `${ringSize(ring.total)}px`;
          const count = document.createElement("span");
          count.textContent = String(ring.total);
          circle.appendChild(count);
          circles.push(circle);
          new maplibre.Marker({ element: circle }).setLngLat([ring.point.lon, ring.point.lat]).addTo(map);
        }
        for (const marker of placed) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `desk-marker desk-marker-${marker.group}`;
          button.setAttribute("aria-label", marker.label);
          button.appendChild(iconElement(hazardIcon(marker.hazardType)));
          button.addEventListener("click", () => {
            const card = document.getElementById(marker.anchor);
            card?.scrollIntoView({ behavior: "smooth", block: "center" });
            card?.focus({ preventScroll: true });
          });
          points.push(button);
          new maplibre.Marker({ element: button }).setLngLat([marker.centre.lon, marker.centre.lat]).addTo(map);
        }
        const bounds = boundsOf(placed.map((marker) => marker.centre));
        if (bounds !== null) map.fitBounds(bounds, { padding: 48, maxZoom: 11, duration: 0 });
        // Far out the rings, near in the points; with no rings the points always.
        const show = () => {
          const far = circles.length > 0 && map.getZoom() < RING_ZOOM;
          for (const circle of circles) circle.style.display = far ? "" : "none";
          for (const point of points) point.style.display = far ? "none" : "";
        };
        map.on("zoom", show);
        show();
      });
      remove = () => {
        theme.disconnect();
        map.remove();
      };
    });
    return () => {
      closed = true;
      remove();
    };
  }, []);
  const hazards = [...new Set(rings.flatMap((ring) => ring.slices.map((one) => one.hazardType)))];
  return (
    <div className="absolute inset-0">
      <section ref={container} aria-label={t(label)} className="size-full">
        {failed ? (
          <p className="flex size-full items-center justify-center bg-sunken p-6 text-center text-muted">
            {t("feed.map.failed")}
          </p>
        ) : null}
      </section>
      {failed || hazards.length === 0 ? null : (
        <ul
          aria-label={t("feed.map.legend")}
          className="absolute start-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap gap-1.5 rounded-control bg-surface/90 p-2 text-meta shadow-sm"
        >
          {hazards.map((hazard) => (
            <li key={hazard} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={cn("size-3 rounded-full", hazardDot(hazard))} />
              {t(hazardKey(hazard))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
