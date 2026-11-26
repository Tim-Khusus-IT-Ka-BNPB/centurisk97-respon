import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef, useState } from "react";
import type { FeedEntry } from "../../../src/contract/publicFeed";
import { hazardKey } from "../../../src/copy/hazardKey";
import { boundsOf, INDONESIA, iconElement, localStyle, STATUS_GROUPS, tileStyle } from "../../lib/deskMap";
import { hazardIcon } from "../../lib/hazardIcons";
import { useText } from "../../lib/text";

type Placed = FeedEntry & { readonly centre: NonNullable<FeedEntry["centre"]> };

// The feed on a map, drawn in the browser only: the list beside it works with no script. Each
// marker stands at its village's centre and leads to its card.
export function FeedMap({ entries }: { readonly entries: readonly FeedEntry[] }) {
  const t = useText();
  const container = useRef<HTMLElement>(null);
  const latest = useRef({ entries, t });
  latest.current = { entries, t };
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
        const { entries: all, t: text } = latest.current;
        const placed = all.filter((entry): entry is Placed => entry.centre !== null);
        for (const entry of placed) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `desk-marker desk-marker-${STATUS_GROUPS[entry.status]}`;
          button.setAttribute(
            "aria-label",
            text("feed.map.marker", {
              hazard: hazardKey(entry.hazardType),
              village: entry.place.villageName,
              status: `feed.status.${entry.status}`,
            }),
          );
          button.appendChild(iconElement(hazardIcon(entry.hazardType)));
          button.addEventListener("click", () => {
            const card = document.getElementById(`feed-${entry.id}`);
            card?.scrollIntoView({ behavior: "smooth", block: "center" });
            card?.focus({ preventScroll: true });
          });
          new maplibre.Marker({ element: button }).setLngLat([entry.centre.lon, entry.centre.lat]).addTo(map);
        }
        const bounds = boundsOf(placed.map((entry) => entry.centre));
        if (bounds !== null) map.fitBounds(bounds, { padding: 48, maxZoom: 11, duration: 0 });
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
  return (
    <div className="absolute inset-0">
      <section ref={container} aria-label={t("feed.map.label")} className="size-full">
        {failed ? (
          <p className="flex size-full items-center justify-center bg-sunken p-6 text-center text-muted">
            {t("feed.map.failed")}
          </p>
        ) : null}
      </section>
    </div>
  );
}
