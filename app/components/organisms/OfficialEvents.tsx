import { Link } from "react-router";
import type { FeedEntry, Official } from "../../../src/contract/publicFeed";
import { hazardKey } from "../../../src/copy/hazardKey";
import { clockTime, localShortDate, shortDate } from "../../../src/copy/time";
import { regencyKey } from "../../../src/domain/officialEvents";
import { cn } from "../../lib/cn";
import { hazardIcon } from "../../lib/hazardIcons";
import { useText } from "../../lib/text";
import { Icon } from "../atoms/Icon";
import { Notice } from "../molecules/Notice";
import { Pagination } from "../molecules/Pagination";

type Event = Official["events"][number];

// Six rows of two on a wide screen; a day's report can hold more than a hundred events.
const OFFICIAL_PAGE_SIZE = 12;

const STATUS_STYLE: Record<Event["status"], string> = {
  berjalan: "bg-signal-tint text-ink",
  belum: "bg-warn-tint text-ink",
  selesai: "bg-sunken text-muted",
};

// How many of our own handled reports are of this event: its regency and hazard.
const ownReports = (event: Event, entries: readonly FeedEntry[]) =>
  entries.filter(
    (entry) =>
      entry.hazardType === event.hazardType && regencyKey(entry.place.regencyName) === regencyKey(event.regencyName),
  ).length;

function Figures({ event }: { readonly event: Event }) {
  const t = useText();
  const figures = (
    [
      ["families", event.families],
      ["displaced", event.displaced],
      ["houses", event.houses],
    ] as const
  ).filter(([, value]) => value !== null);
  if (figures.length === 0) return <p className="text-meta text-muted">{t("official.noFigures")}</p>;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta">
      {figures.map(([name, value]) => (
        <li key={name}>{t(`official.figure.${name}`, { count: value as number })}</li>
      ))}
    </ul>
  );
}

function EventCard({ event, entries }: { readonly event: Event; readonly entries: readonly FeedEntry[] }) {
  const t = useText();
  const own = ownReports(event, entries);
  return (
    <li className="flex flex-col gap-3 card-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 font-bold">
          <Icon name={hazardIcon(event.hazardType)} className="size-5 shrink-0 text-primary" />
          {t("official.title", { hazard: t(hazardKey(event.hazardType)), regency: event.regencyName })}
        </h3>
        <span className={cn("rounded-control px-2 text-meta font-semibold", STATUS_STYLE[event.status])}>
          {t(`official.status.${event.status}`)}
        </span>
      </div>
      <section className="flex flex-col gap-1 border-t border-line pt-3">
        <h4 className="text-meta font-semibold text-muted">{t("official.band.bnpb")}</h4>
        <p className="text-meta">
          {t("official.dates", { started: localShortDate(event.startedOn), last: localShortDate(event.lastReportOn) })}
        </p>
        <Figures event={event} />
      </section>
      <section className="flex flex-col gap-1 border-t border-line pt-3">
        <h4 className="text-meta font-semibold text-muted">{t("official.band.residents")}</h4>
        {own === 0 ? (
          <p className="text-meta text-muted">{t("official.residents.none")}</p>
        ) : (
          <Link to={`/feed?hazard=${event.hazardType}`} className="text-meta font-semibold">
            {t("official.residents.some", { count: own })}
          </Link>
        )}
      </section>
      <details className="group border-t border-line pt-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-meta font-semibold text-muted [&::-webkit-details-marker]:hidden">
          {t("official.band.news", { count: event.news.length + event.moreNews })}
          <Icon
            name="chevronRight"
            className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          />
        </summary>
        {event.news.length === 0 ? (
          <p className="pt-2 text-meta text-muted">{t("official.news.none")}</p>
        ) : (
          <ul className="flex flex-col gap-2 pt-2">
            {event.news.map((news) => (
              <li key={news.url} className="flex flex-col">
                <a href={news.url} target="_blank" rel="noopener noreferrer" className="text-meta font-semibold">
                  {news.title}
                </a>
                <span className="text-meta text-muted">
                  {t("official.news.source", { outlet: news.outlet, date: localShortDate(news.date) })}
                </span>
              </li>
            ))}
            {event.moreNews > 0 ? (
              <li className="text-meta text-muted">{t("official.news.more", { count: event.moreNews })}</li>
            ) : null}
          </ul>
        )}
      </details>
    </li>
  );
}

// BNPB's daily report on the Alun-alun (upstream kabar-alun, row 26): each event with the report's
// status and figures, our own handled reports of it, and the news found for it, a page at a time,
// ongoing first. With a hazard picked, only its events. When upstream made the file shows under the
// heading, and a file more than a day old says no newer report has come.
export function OfficialEvents({
  official,
  entries,
  hazard,
  page = 1,
  pageHref,
}: {
  readonly official: Official | null;
  readonly entries: readonly FeedEntry[];
  readonly hazard: string | null;
  readonly page?: number;
  readonly pageHref: (page: number) => string;
}) {
  const t = useText();
  const events = (official?.events ?? []).filter((event) => hazard === null || event.hazardType === hazard);
  const pages = Math.max(1, Math.ceil(events.length / OFFICIAL_PAGE_SIZE));
  const shown = Math.min(Math.max(1, page), pages);
  const onPage = events.slice((shown - 1) * OFFICIAL_PAGE_SIZE, shown * OFFICIAL_PAGE_SIZE);
  const built = official?.builtAt == null ? null : ({ utc: official.builtAt, zone: "WIB" } as const);
  return (
    <section aria-labelledby="official-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="official-title" className="text-section font-bold">
          {t("official.heading")}
        </h2>
        <p className="text-meta text-muted">
          {official?.day == null
            ? t("official.unavailable")
            : t("official.lead", { day: localShortDate(official.day) })}
          {built === null ? null : ` ${t("official.updated", { date: shortDate(built), time: clockTime(built) })}`}
        </p>
      </div>
      {official?.stale ? <Notice kind="info">{t("official.stale")}</Notice> : null}
      {official?.day != null && events.length === 0 ? <p className="card-surface p-4">{t("official.none")}</p> : null}
      {onPage.length > 0 ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {onPage.map((event) => (
            <EventCard key={event.id} event={event} entries={entries} />
          ))}
        </ul>
      ) : null}
      <Pagination
        page={shown}
        pages={pages}
        hrefFor={pageHref}
        labels={{
          summary: t("official.page", { page: shown, pages, total: events.length }),
          previous: t("official.previous"),
          next: t("official.next"),
        }}
      />
    </section>
  );
}
