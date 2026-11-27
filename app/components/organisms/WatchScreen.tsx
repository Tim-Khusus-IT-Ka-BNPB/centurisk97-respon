import { Link } from "react-router";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import type { Watch } from "../../../src/contract/publicFeed";
import { cn } from "../../lib/cn";
import { isLimit } from "../../lib/envelope";
import { limitText } from "../../lib/status";
import { useText } from "../../lib/text";
import { Icon } from "../atoms/Icon";
import { Notice } from "../molecules/Notice";
import { FeedHeader } from "./FeedScreen";
import { LevelTag } from "./InfoScreen";

export type WatchLoad =
  | { readonly kind: "watch"; readonly watch: Watch }
  | { readonly kind: "unavailable"; readonly envelope: ErrorEnvelope | null };

const madeTime = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" });
const made = (iso: string) => madeTime.format(new Date(iso));

// MAGMA's four levels, Normal to Awas, in the colours of the outlook's.
const VOLCANO_STYLE = [
  "bg-sunken text-ink",
  "bg-warn-tint text-ink",
  "bg-siaga text-on-siaga",
  "bg-signal text-on-signal",
];

function Forecast({ forecast }: { readonly forecast: Watch["forecast"] }) {
  const t = useText();
  return (
    <section aria-labelledby="watch-forecast" className="flex flex-col gap-3">
      <h2 id="watch-forecast" className="text-section font-bold">
        {t("watch.forecast.title")}
      </h2>
      {forecast === null ? (
        <Notice kind="info">
          <p>{t("watch.forecast.unavailable")}</p>
        </Notice>
      ) : (
        <>
          <p className="max-w-[65ch] text-meta text-muted">
            {t("watch.forecast.lead", { time: made(forecast.madeAt) })}
          </p>
          {forecast.regencies.length === 0 ? (
            <p className="card-surface p-4">{t("watch.forecast.none")}</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {forecast.regencies.map((one) => (
                <li key={one.regencyCode} className="min-w-0">
                  <Link
                    to={`/info?regency=${one.regencyCode}`}
                    className="flex h-full flex-col gap-2 card-surface p-4 text-ink no-underline hover:border-primary"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block font-bold">{one.regencyName}</span>
                        <span className="block text-meta text-muted">{one.provinceName}</span>
                      </span>
                      <LevelTag level={one.level} />
                    </span>
                    <span className="text-meta">{one.threats.join(", ")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Volcanoes({ volcanoes }: { readonly volcanoes: Watch["volcanoes"] }) {
  const t = useText();
  return (
    <section aria-labelledby="watch-volcanoes" className="flex flex-col gap-3">
      <h2 id="watch-volcanoes" className="text-section font-bold">
        {t("watch.volcano.title")}
      </h2>
      {volcanoes === null ? (
        <Notice kind="info">
          <p>{t("watch.volcano.unavailable")}</p>
        </Notice>
      ) : (
        <>
          <p className="text-meta text-muted">
            {t("watch.volcano.source", { source: volcanoes.source, time: made(volcanoes.madeAt) })}
          </p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([1, 2, 3, 4] as const).map((level) => (
              <li key={level} className={cn("flex flex-col rounded-card p-3", VOLCANO_STYLE[level - 1])}>
                <span className="text-page font-extrabold tabular-nums">{volcanoes.counts[level - 1]}</span>
                <span className="text-meta font-semibold">{t(`watch.volcano.level.${level}`)}</span>
              </li>
            ))}
          </ul>
          {volcanoes.raised.length === 0 ? (
            <p className="card-surface p-4">{t("watch.volcano.none")}</p>
          ) : (
            <ul className="flex flex-col overflow-hidden card-surface">
              {volcanoes.raised.map((one) => (
                <li
                  key={one.name}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-3 first:border-t-0"
                >
                  <span className={cn("rounded-control px-2 text-meta font-semibold", VOLCANO_STYLE[one.level - 1])}>
                    {t(`watch.volcano.level.${one.level}`)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{t("watch.volcano.name", { name: one.name })}</span>
                    <span className="block text-meta text-muted">
                      {one.province}.{" "}
                      {one.radiusKm === null
                        ? t("watch.volcano.noRadius")
                        : t("watch.volcano.radius", { km: one.radiusKm })}
                    </span>
                  </span>
                  {one.report === null ? null : (
                    <a
                      href={one.report}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1 text-meta font-semibold"
                    >
                      {t("watch.volcano.report")}
                      <Icon name="link" className="size-4" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// The Alun-alun's Peringatan view: the regencies the outlook puts on watch, and the volcanoes at
// Siaga or Awas with how far to keep away.
export function WatchScreen({ load }: { readonly load: WatchLoad }) {
  const t = useText();
  return (
    <div className="flex flex-col gap-8">
      <FeedHeader mode="watch" />
      {load.kind === "unavailable" ? (
        <Notice kind={isLimit(load.envelope) ? "limit" : "error"}>
          <p>
            {isLimit(load.envelope) ? limitText(t, load.envelope as ErrorEnvelope, Date.now()) : t("watch.unavailable")}
          </p>
        </Notice>
      ) : (
        <>
          <Forecast forecast={load.watch.forecast} />
          <Volcanoes volcanoes={load.watch.volcanoes} />
        </>
      )}
    </div>
  );
}
