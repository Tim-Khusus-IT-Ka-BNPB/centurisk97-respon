import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { DeskMap, DeskQueue, DeskSummary } from "../../../../src/contract/desk";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { hazardKey } from "../../../../src/copy/hazardKey";
import { GROUPS, STATUS_GROUPS } from "../../../lib/deskMap";
import type { DeskFilters } from "../../../lib/deskTypes";
import { hazardIcon } from "../../../lib/hazardIcons";
import { useText } from "../../../lib/text";
import { buttonStyles } from "../../atoms/Button";
import { Icon } from "../../atoms/Icon";
import { DeskMapCanvas } from "../DeskMapCanvas";
import { ClearFilters, HasTiles, HazardChips, PeriodSegment, TicketSearch, ViewTabs } from "./DeskFilters";
import {
  deskLink,
  EmergencyChip,
  Impact,
  type Item,
  isFiltered,
  NewsChip,
  OfflineChip,
  OverdueChip,
  StatusChip,
  whenShort,
} from "./parts";

function Legend() {
  const t = useText();
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 border-y border-line bg-surface px-4 py-2 text-meta lg:absolute lg:bottom-3 lg:left-3 lg:flex-col lg:rounded-control lg:border-0 lg:px-3 lg:shadow-float">
      {GROUPS.map((group) => (
        <li key={group} className="flex items-center gap-2 whitespace-nowrap">
          <span aria-hidden="true" className={`desk-dot desk-dot-${group}`} />
          {t(`desk.map.group.${group}`)}
        </li>
      ))}
    </ul>
  );
}

// One report beside the map. Pointing at it marks it on the map.
function PanelItem({ item, onPoint }: { readonly item: Item; readonly onPoint: (ticket: string | null) => void }) {
  const t = useText();
  const photos = item.photoCount > 0;
  return (
    <li
      className="border-t border-line first:border-t-0"
      onMouseEnter={() => onPoint(item.ticketNumber)}
      onMouseLeave={() => onPoint(null)}
      onFocus={() => onPoint(item.ticketNumber)}
      onBlur={() => onPoint(null)}
    >
      <Link
        to={`/desk/${item.ticketNumber}`}
        className="flex gap-3 px-4 py-3 text-ink no-underline hover:bg-sunken xl:px-5"
      >
        <span aria-hidden="true" className={`desk-pin desk-marker-${STATUS_GROUPS[item.status]}`}>
          <Icon name={hazardIcon(item.hazardType)} className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="font-bold tabular-nums">{item.ticketNumber}</span>
            <span className="flex flex-wrap justify-end gap-1.5">
              {item.emergency === null || item.offline?.late ? null : <EmergencyChip />}
              {item.offline === null ? null : <OfflineChip offline={item.offline} />}
              {item.news ? <NewsChip /> : null}
              {item.overdue ? <OverdueChip /> : null}
              <StatusChip status={item.status} />
            </span>
          </span>
          <span>
            {t("desk.map.row", {
              hazard: t(hazardKey(item.hazardType)),
              village: item.place.villageName,
              regency: item.place.regencyName,
            })}
          </span>
          <Impact impact={item.impact} />
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted">
            <span className="tabular-nums">{whenShort(t, item.sentAt)}</span>
            {photos ? (
              <span className="inline-flex items-center gap-1">
                <Icon name="camera" className="size-4" />
                {t("desk.row.photos", { count: item.photoCount })}
              </span>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

const NO_POINTS: DeskMap["points"] = [];

// The desk opens here: where the reports are, and beside the map what to open next. The list
// follows the map as it is moved. With no script the list and the table of points stand alone.
export function DeskMapView({
  map,
  queue,
  summary,
  filters,
  envelope,
}: {
  // Null while a search is refused.
  readonly map: DeskMap | null;
  readonly queue: DeskQueue | null;
  readonly summary: DeskSummary | null;
  readonly filters: DeskFilters;
  readonly envelope: ErrorEnvelope | null;
}) {
  const t = useText();
  const points = map?.points ?? NO_POINTS;
  const [inView, setInView] = useState<ReadonlySet<string> | null>(null);
  const [pointed, setPointed] = useState<string | null>(null);
  const located = useMemo(() => new Set(points.map((point) => point.ticketNumber)), [points]);
  const items = queue?.items ?? [];
  // A report with no point on the map is always listed, or it could never be found here.
  const listed = items.filter(
    (item) => inView === null || inView.has(item.ticketNumber) || !located.has(item.ticketNumber),
  );
  return (
    <div className="flex flex-1 flex-col lg:min-h-0 xl:grid xl:grid-cols-[minmax(0,1fr)_25rem] xl:grid-rows-[minmax(0,1fr)]">
      <div className="relative flex flex-col lg:min-h-0 lg:flex-1">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 lg:sr-only">
          <h1 className="text-page font-bold">{t("desk.heading.map")}</h1>
          <ViewTabs filters={filters} />
        </div>
        <section
          aria-label={t("desk.filters")}
          className="flex flex-col gap-2 p-4 lg:absolute lg:inset-x-3 lg:top-3 lg:z-10 lg:flex-row lg:items-center lg:rounded-card lg:bg-surface lg:p-2 lg:shadow-float"
        >
          <HazardChips filters={filters} summary={summary} className="fade-x overflow-x-auto lg:flex-1" />
          <ClearFilters filters={filters} className="self-start lg:shrink-0 lg:self-auto" />
        </section>
        <div className="relative h-[46dvh] min-h-72 lg:h-auto lg:min-h-0 lg:flex-1">
          <DeskMapCanvas points={points} label={t("desk.map.title")} pointed={pointed} onView={setInView} />
          <noscript>
            <p className="absolute inset-x-4 top-1/2 text-center">{t("desk.map.noscript")}</p>
          </noscript>
        </div>
        <Legend />
      </div>
      <section
        aria-label={t("desk.map.panel")}
        className="flex flex-col border-line bg-header lg:h-[42dvh] lg:overflow-y-auto lg:border-t xl:h-auto xl:border-s xl:border-t-0"
      >
        <div className="flex flex-col gap-3 border-b border-line p-4 xl:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-card font-bold tabular-nums">
              {queue === null ? null : t("desk.count", { count: queue.total })}
            </p>
            <p role="status" className="text-meta text-muted tabular-nums">
              {listed.length < items.length ? t("desk.map.inView", { count: listed.length }) : null}
            </p>
          </div>
          {filters.status === "" ? null : (
            <p className="text-muted">{t("desk.heading.queue", { status: `stage.short.${filters.status}` })}</p>
          )}
          <PeriodSegment filters={filters} className="w-full" />
          <TicketSearch filters={filters} envelope={envelope} />
          <HasTiles filters={filters} summary={summary} />
        </div>
        {queue !== null && items.length === 0 ? (
          <p className="p-4 text-muted xl:p-5">{t(isFiltered(filters) ? "desk.empty" : "desk.empty.none")}</p>
        ) : null}
        {items.length > 0 && listed.length === 0 ? (
          <p className="p-4 text-muted xl:p-5">{t("desk.map.inViewNone")}</p>
        ) : null}
        <ul>
          {listed.map((item) => (
            <PanelItem key={item.ticketNumber} item={item} onPoint={setPointed} />
          ))}
        </ul>
        {queue !== null && queue.pageCount > 1 ? (
          <div className="flex flex-col items-start gap-2 border-t border-line p-4 xl:p-5">
            <p className="text-meta text-muted">{t("desk.map.newest", { count: items.length })}</p>
            <Link to={deskLink(filters, { view: "list", page: 1 })} className={buttonStyles({ variant: "secondary" })}>
              {t("desk.map.toList")}
            </Link>
          </div>
        ) : null}
        {map?.cut ? (
          <p className="border-t border-line p-4 text-meta text-muted xl:p-5">
            {t("desk.map.cut", { count: map.points.length })}
          </p>
        ) : null}
        {points.length === 0 ? null : (
          <details className="border-t border-line px-4 py-2 xl:px-5">
            <summary className="min-h-target py-2 font-semibold">
              {t("desk.map.table", { count: points.length })}
            </summary>
            <ul className="flex flex-col gap-3 py-2">
              {points.map((point) => (
                <li key={point.ticketNumber} className="flex flex-col">
                  <Link to={`/desk/${point.ticketNumber}`} className="font-bold tabular-nums">
                    {point.ticketNumber}
                  </Link>
                  <span>{`${t(hazardKey(point.hazardType))}, ${t(`stage.short.${point.status}`)}, ${point.villageName}`}</span>
                  <span className="text-meta text-muted tabular-nums">
                    {`${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}, ${t(`desk.map.precision.${point.precision}`)}`}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
