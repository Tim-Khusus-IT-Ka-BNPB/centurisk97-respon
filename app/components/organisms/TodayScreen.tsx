import type { ReactNode } from "react";
import { Link } from "react-router";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import type { Today } from "../../../src/contract/today";
import { hazardKey } from "../../../src/copy/hazardKey";
import { cn } from "../../lib/cn";
import type { MapMarker } from "../../lib/deskMap";
import { isLimit } from "../../lib/envelope";
import { hazardIcon } from "../../lib/hazardIcons";
import { limitText } from "../../lib/status";
import { useText } from "../../lib/text";
import { buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { eventShort, whenShort } from "./desk/parts";
import { FeedMap } from "./FeedMap";
import { chip } from "./FeedScreen";

export type TodayLoad =
  | { readonly kind: "today"; readonly today: Today }
  | { readonly kind: "closed" }
  | { readonly kind: "unavailable"; readonly envelope: ErrorEnvelope | null };

type TodayEvent = Today["events"][number];

const FIGURES = ["dead", "missing", "injured", "displaced", "houses"] as const;
const anchor = (event: TodayEvent) => `today-${event.id}`;

function Figures({ impact }: { readonly impact: TodayEvent["impact"] }) {
  const t = useText();
  const known = FIGURES.flatMap((figure) => {
    const range = impact[figure];
    return range === undefined ? [] : [{ figure, range }];
  });
  if (known.length === 0) return <p className="text-meta text-muted">{t("today.impact.none")}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <table className="w-full text-start text-meta">
        <caption className="sr-only">{t("today.impact.caption")}</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">{t("today.impact.field")}</th>
            <th scope="col">{t("today.impact.reported")}</th>
          </tr>
        </thead>
        <tbody>
          {known.map(({ figure, range }) => (
            <tr key={figure} className="border-t border-line first:border-t-0">
              <th scope="row" className="py-1 pe-3 text-start font-normal text-muted">
                {t(`today.impact.${figure}`)}
              </th>
              <td className="py-1 text-end font-semibold tabular-nums">
                {range.min === range.max ? range.min : t("today.range", { min: range.min, max: range.max })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-meta text-muted">{t("today.impact.note")}</p>
    </div>
  );
}

function TodayCard({ event }: { readonly event: TodayEvent }) {
  const t = useText();
  const subtype = event.hazardSubtype ? t(`hazardSubtype.${event.hazardType}.${event.hazardSubtype}.label`) : null;
  return (
    <li>
      <article
        id={anchor(event)}
        tabIndex={-1}
        aria-labelledby={`${anchor(event)}-title`}
        className="flex flex-col gap-3 card-surface p-4 outline-offset-2 md:p-5"
      >
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-sunken text-primary">
            <Icon name={hazardIcon(event.hazardType)} />
          </span>
          <div className="flex min-w-48 flex-1 flex-col gap-0.5">
            <h3 id={`${anchor(event)}-title`} className="text-body font-bold">
              {t(hazardKey(event.hazardType))}
              {subtype ? <span className="font-normal text-muted">, {subtype}</span> : null}
            </h3>
            <p className="text-meta text-muted">
              {t("feed.place", {
                village: event.place.villageName,
                district: event.place.districtName,
                regency: event.place.regencyName,
                province: event.place.provinceName,
              })}
            </p>
          </div>
        </div>
        <p className="inline-flex items-start gap-2 text-meta font-semibold">
          <Icon name="circleCheck" className="mt-0.5 size-4 shrink-0 text-primary" />
          {t("today.verified", {
            bpbd: t(`today.by.${event.verifiedBy.level}`, { name: event.verifiedBy.name }),
            when: whenShort(t, event.verifiedAt),
          })}
        </p>
        <Figures impact={event.impact} />
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted">
          {event.eventTime ? <span>{t("feed.event", { when: eventShort(t, event.eventTime) })}</span> : null}
          {event.reporters ? (
            <span className="inline-flex items-center gap-1.5">
              <Icon name="users" className="size-4" />
              {t("today.reporters", { count: event.reporters })}
            </span>
          ) : null}
        </p>
      </article>
    </li>
  );
}

// The kinds among the events, as links; only with two kinds or more to choose from.
function Filters({ events, hazard }: { readonly events: readonly TodayEvent[]; readonly hazard: string | null }) {
  const t = useText();
  const kinds = [...new Set(events.map((event) => event.hazardType))];
  if (kinds.length < 2) return null;
  return (
    <nav aria-label={t("today.filter.label")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6">
      <Link to="/today" aria-current={hazard === null ? "true" : undefined} className={chip}>
        {t("today.filter.all")}
      </Link>
      {kinds.map((kind) => (
        <Link
          key={kind}
          to={`/today?hazard=${kind}`}
          aria-current={hazard === kind ? "true" : undefined}
          className={chip}
        >
          <Icon name={hazardIcon(kind)} className="size-4" />
          {t(hazardKey(kind))}
        </Link>
      ))}
    </nav>
  );
}

function Message({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section aria-labelledby="today-message" className="flex flex-col items-start gap-3 card-surface p-5 md:p-7">
      <h2 id="today-message" className="text-section font-bold tracking-[-0.015em]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Method() {
  const t = useText();
  return (
    <details className="group card-surface p-4 md:p-5">
      <summary className="flex min-h-target list-none items-center gap-1.5 font-semibold text-primary [&::-webkit-details-marker]:hidden">
        <Icon name="chevronRight" className="size-4 group-open:rotate-90" />
        {t("today.method.title")}
      </summary>
      <p className="max-w-[70ch] pt-2 text-muted">{t("today.method.body")}</p>
    </details>
  );
}

// The public today page (upstream lapor-kejadian, row 36): events their region's BPBD verified in
// the last 24 hours, read on the server so the list shows with no script; the map is drawn beside.
export function TodayScreen({ load, hazard }: { readonly load: TodayLoad; readonly hazard: string | null }) {
  const t = useText();
  if (load.kind === "closed")
    return (
      <Message title={t("today.closed")}>
        <Link to="/" className={buttonStyles({ variant: "secondary" })}>
          {t("today.closed.home")}
        </Link>
      </Message>
    );
  if (load.kind === "unavailable") {
    const { envelope } = load;
    return (
      <Message title={t("today.unavailable")}>
        {envelope !== null && isLimit(envelope) ? (
          <p className="text-muted">{limitText(t, envelope, Date.now())}</p>
        ) : null}
        <a href="/today" className={buttonStyles({ variant: "secondary" })}>
          {t("today.retry")}
        </a>
      </Message>
    );
  }
  const all = load.today.events;
  const events = hazard === null ? all : all.filter((event) => event.hazardType === hazard);
  const markers: MapMarker[] = events.map((event) => ({
    anchor: anchor(event),
    hazardType: event.hazardType,
    centre: event.centre,
    label: t("today.map.marker", { hazard: hazardKey(event.hazardType), village: event.place.villageName }),
    group: "working",
  }));
  return (
    <div className="flex flex-col gap-5">
      <Filters events={all} hazard={hazard} />
      {events.length === 0 ? (
        <Message title={t("today.empty")}>
          <p className="max-w-[65ch] text-muted">{t("today.empty.lead")}</p>
          <div className="flex flex-wrap gap-3">
            <Link to="/feed" className={buttonStyles({ variant: "secondary" })}>
              {t("today.empty.feed")}
            </Link>
            <Link to="/numbers" className={buttonStyles({ variant: "secondary" })}>
              {t("today.empty.numbers")}
            </Link>
          </div>
        </Message>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div
            className={cn(
              "relative h-72 overflow-hidden rounded-card border border-line md:h-96",
              "lg:sticky lg:top-6 lg:order-2 lg:h-[calc(100dvh-8rem)]",
            )}
          >
            <FeedMap key={hazard ?? "all"} markers={markers} label="today.map.label" />
          </div>
          <section aria-labelledby="today-count" className="flex min-w-0 flex-col gap-3 lg:order-1">
            <h2 id="today-count" className="text-meta font-semibold text-muted">
              {t("feed.count", { count: events.length })}
            </h2>
            <ul className="flex flex-col gap-3">
              {events.map((event) => (
                <TodayCard key={event.id} event={event} />
              ))}
            </ul>
          </section>
        </div>
      )}
      <Method />
    </div>
  );
}
