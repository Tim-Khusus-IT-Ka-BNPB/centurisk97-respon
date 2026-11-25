import { Form, Link } from "react-router";
import type { DeskGallery, DeskMap, DeskQueue, DeskSummary } from "../../../../src/contract/desk";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { DESK_PERIODS } from "../../../../src/domain/deskQueue";
import { HAZARD_TYPE_IDS, SELECTABLE_HAZARD_TYPES } from "../../../../src/domain/hazards";
import { cn } from "../../../lib/cn";
import { GROUPS } from "../../../lib/deskMap";
import { DESK_VIEWS, type DeskFilters, type DeskShown } from "../../../lib/deskTypes";
import { problemOf } from "../../../lib/envelope";
import { hazardIcon } from "../../../lib/hazardIcons";
import { useFocusOnChange } from "../../../lib/hooks";
import { valueLines } from "../../../lib/summary";
import { useText } from "../../../lib/text";
import { buttonStyles } from "../../atoms/Button";
import { Input } from "../../atoms/controls";
import { Icon } from "../../atoms/Icon";
import { FieldError } from "../../molecules/Field";
import { Notice } from "../../molecules/Notice";
import { DeskMapCanvas } from "../DeskMapCanvas";
import { counted, DeskShell } from "./DeskShell";
import { deskLink, eventShort, Houses, type Item, StatusChip, UnverifiedMark, Victims, when, whenShort } from "./parts";

const chip =
  "inline-flex min-h-target-min shrink-0 items-center gap-2 rounded-control border border-line bg-surface px-3 text-ink no-underline hover:bg-sunken aria-[current=true]:border-primary aria-[current=true]:bg-selected aria-[current=true]:font-semibold";

const segment =
  "inline-flex min-h-target-min items-center justify-center rounded-[6px] px-3 text-ink no-underline hover:bg-sunken aria-[current=true]:bg-primary aria-[current=true]:font-semibold aria-[current=true]:text-on-primary";

function Tally({ n }: { readonly n: number | undefined }) {
  return n === undefined ? null : (
    <span className="rounded-chip bg-sunken px-1.5 text-meta tabular-nums">{n.toLocaleString("id-ID")}</span>
  );
}

// Hazard chips with their counts, the period, the ticket search and a way back to everything.
function FilterBar({
  filters,
  summary,
  envelope,
}: {
  readonly filters: DeskFilters;
  readonly summary: DeskSummary | null;
  readonly envelope: ErrorEnvelope | null;
}) {
  const t = useText();
  const problem = problemOf(envelope, "ticket");
  useFocusOnChange(problem === null ? null : "ticket", envelope);
  const byHazard = summary?.byHazard;
  // With counts: the types that have reports, and the one picked. Without: every type offered.
  const hazards =
    byHazard === undefined
      ? SELECTABLE_HAZARD_TYPES
      : HAZARD_TYPE_IDS.filter((id) => (byHazard[id] ?? 0) > 0 || filters.hazardType === id);
  const allHazards =
    byHazard === undefined ? undefined : Object.values(byHazard).reduce((sum: number, n) => sum + (n as number), 0);
  const filtered =
    filters.status !== "" || filters.hazardType !== "" || filters.period !== "all" || filters.ticket !== "";
  return (
    <section aria-label={t("desk.filters")} className="flex flex-col gap-3 card-surface p-3 md:p-4">
      <nav aria-label={t("desk.filter.hazard")} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <Link
          to={deskLink(filters, { hazardType: "", page: 1 })}
          aria-current={filters.hazardType === "" ? "true" : undefined}
          aria-label={counted(t, t("desk.filter.allHazards"), allHazards)}
          className={chip}
        >
          {t("desk.filter.allHazards")}
          <Tally n={allHazards} />
        </Link>
        {hazards.map((id) => (
          <Link
            key={id}
            to={deskLink(filters, { hazardType: filters.hazardType === id ? "" : id, page: 1 })}
            aria-current={filters.hazardType === id ? "true" : undefined}
            aria-label={counted(t, t(`hazard.${id}.label`), byHazard === undefined ? undefined : (byHazard[id] ?? 0))}
            className={chip}
          >
            <Icon name={hazardIcon(id)} className="size-4" />
            {t(`hazard.${id}.label`)}
            <Tally n={byHazard === undefined ? undefined : (byHazard[id] ?? 0)} />
          </Link>
        ))}
      </nav>
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <nav
          aria-label={t("desk.filter.period")}
          className="inline-flex w-fit max-w-full flex-wrap rounded-control border border-line bg-surface p-0.5"
        >
          {DESK_PERIODS.map((period) => (
            <Link
              key={period}
              to={deskLink(filters, { period, page: 1 })}
              aria-current={filters.period === period ? "true" : undefined}
              className={segment}
            >
              {t(`desk.period.${period}`)}
            </Link>
          ))}
        </nav>
        <Form method="get" role="search" className="flex flex-col gap-1">
          {(["view", "status", "hazardType", "period"] as const).map((name) =>
            filters[name] === "" ? null : <input key={name} type="hidden" name={name} value={filters[name]} />,
          )}
          <div className="flex items-center gap-2">
            <label htmlFor="ticket" className="sr-only">
              {t("desk.filter.ticket")}
            </label>
            <Input
              id="ticket"
              name="ticket"
              defaultValue={filters.ticket}
              placeholder={t("desk.filter.ticketHint")}
              autoComplete="off"
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? "ticket-error" : undefined}
              autoFocus={problem !== null}
              className="w-44 md:w-52"
            />
            <button type="submit" className={buttonStyles({ variant: "primary" })}>
              <Icon name="search" className="size-4" />
              {t("desk.filter.search")}
            </button>
            {filtered ? (
              <Link to="/lapor/meja" className={buttonStyles({ variant: "quiet" })}>
                {t("desk.filter.clear")}
              </Link>
            ) : null}
          </div>
          <FieldError id="ticket" problem={problem} />
        </Form>
      </div>
    </section>
  );
}

// On a phone the views sit above the work; on a wide screen the side menu holds them.
function ViewTabs({ filters }: { readonly filters: DeskFilters }) {
  const t = useText();
  return (
    <nav
      aria-label={t("desk.views")}
      className="inline-flex w-fit rounded-control border border-line bg-surface p-0.5 lg:hidden"
    >
      {DESK_VIEWS.map((view) => (
        <Link
          key={view}
          to={deskLink(filters, { view, page: 1 })}
          aria-current={filters.view === view ? "true" : undefined}
          className={segment}
        >
          {t(`desk.view.${view}`)}
        </Link>
      ))}
    </nav>
  );
}

const placeOf = (t: ReturnType<typeof useText>, item: Item) =>
  t("desk.row.placeShort", { village: item.place.villageName, regency: item.place.regencyName });

export function Hazard({ item }: { readonly item: Pick<Item, "hazardType" | "hazardSubtype"> }) {
  const t = useText();
  const subtype = valueLines(t, "hazardSubtype", {
    kind: "hazardSubtype",
    hazardType: item.hazardType,
    subtype: item.hazardSubtype,
  })[0];
  return (
    <span className="flex items-start gap-2">
      <Icon name={hazardIcon(item.hazardType)} className="mt-0.5 size-5 text-muted" />
      <span className="flex min-w-0 flex-col">
        <span className="font-semibold">{t(`hazard.${item.hazardType}.label`)}</span>
        <span className="text-meta text-muted">{subtype}</span>
      </span>
    </span>
  );
}

function Filled({ item }: { readonly item: Item }) {
  const t = useText();
  return (
    <span className="flex flex-col items-end gap-0.5 text-meta whitespace-nowrap tabular-nums">
      <span className="font-semibold">{t("desk.row.completeShort", { percent: item.completePercent })}</span>
      <span className="inline-flex items-center gap-1 text-muted">
        <Icon name="camera" className="size-4" />
        {t("desk.row.photos", { count: item.photoCount })}
      </span>
    </span>
  );
}

const cell = "border-t border-line px-3 py-3 align-top";

// A wide screen reads the queue as a table; the ticket is the row's link.
function QueueTable({ items }: { readonly items: readonly Item[] }) {
  const t = useText();
  return (
    <div className="hidden overflow-x-auto card-surface xl:block">
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead>
          <tr className="text-meta text-muted">
            {(["ticket", "event", "victims", "houses", "sent", "reporter"] as const).map((column) => (
              <th key={column} scope="col" className="px-3 py-2.5 font-semibold">
                {t(`desk.col.${column}`)}
              </th>
            ))}
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">
              {t("desk.col.filled")}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.ticketNumber} className="relative hover:bg-sunken">
              <td className={cell}>
                <span className="flex flex-col items-start gap-1.5">
                  <Link
                    to={`/lapor/meja/${item.ticketNumber}`}
                    className="font-bold whitespace-nowrap text-ink tabular-nums no-underline after:absolute after:inset-0 hover:underline"
                  >
                    {item.ticketNumber}
                  </Link>
                  <StatusChip status={item.status} />
                </span>
              </td>
              <td className={cn(cell, "min-w-40")}>
                <span className="flex flex-col gap-1">
                  <Hazard item={item} />
                  <span className="text-meta">{placeOf(t, item)}</span>
                </span>
              </td>
              <td className={cell}>
                <Victims impact={item.impact} className="grid w-max grid-cols-2" />
              </td>
              <td className={cell}>
                <Houses impact={item.impact} />
              </td>
              <td className={cn(cell, "text-meta tabular-nums")}>
                <span className="flex flex-col gap-0.5 whitespace-nowrap">
                  <span>{whenShort(t, item.sentAt)}</span>
                  <span className="text-muted">
                    {t("desk.row.eventTime", { value: eventShort(t, item.eventTime) })}
                  </span>
                </span>
              </td>
              <td className={cell}>
                <span className="flex flex-col items-start gap-1">
                  <span>{item.reporter.name}</span>
                  <span className="text-meta text-muted">{t(`desk.role.${item.reporter.role}`)}</span>
                  {item.numberUnverified ? <UnverifiedMark /> : null}
                </span>
              </td>
              <td className={cn(cell, "text-right")}>
                <Filled item={item} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Too narrow for the table, the queue reads as cards, each one link.
function QueueCards({ items }: { readonly items: readonly Item[] }) {
  const t = useText();
  return (
    <ul className="grid gap-3 lg:grid-cols-2 xl:hidden">
      {items.map((item) => (
        <li key={item.ticketNumber}>
          <Link
            to={`/lapor/meja/${item.ticketNumber}`}
            className="flex h-full flex-col gap-2.5 card-surface p-4 text-ink no-underline hover:bg-sunken"
          >
            <span className="flex items-center justify-between gap-3">
              <span className="font-bold tabular-nums">{item.ticketNumber}</span>
              <StatusChip status={item.status} />
            </span>
            <Hazard item={item} />
            <span className="text-meta">{placeOf(t, item)}</span>
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Victims impact={item.impact} />
              <Houses impact={item.impact} />
            </span>
            <span className="flex flex-wrap items-center justify-between gap-2 mt-auto border-t border-line pt-2.5 text-meta">
              <span className="flex flex-wrap items-center gap-2">
                <span>{item.reporter.name}</span>
                {item.numberUnverified ? <UnverifiedMark /> : null}
              </span>
              <span className="text-muted tabular-nums">{whenShort(t, item.sentAt)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ListView({ queue, filters }: { readonly queue: DeskQueue; readonly filters: DeskFilters }) {
  const t = useText();
  if (queue.items.length === 0)
    return (
      <Notice kind="info">
        <p>{t("desk.empty")}</p>
      </Notice>
    );
  return (
    <>
      <QueueTable items={queue.items} />
      <QueueCards items={queue.items} />
      {queue.pageCount > 1 ? (
        <nav
          aria-label={t("desk.page", { page: queue.page, pages: queue.pageCount })}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <span className="text-muted">{t("desk.page", { page: queue.page, pages: queue.pageCount })}</span>
          <span className="flex flex-wrap gap-3">
            {queue.page > 1 ? (
              <Link to={deskLink(filters, { page: queue.page - 1 })} className={buttonStyles({ variant: "secondary" })}>
                {t("desk.previous")}
              </Link>
            ) : null}
            {queue.page < queue.pageCount ? (
              <Link to={deskLink(filters, { page: queue.page + 1 })} className={buttonStyles({ variant: "secondary" })}>
                {t("desk.next")}
              </Link>
            ) : null}
          </span>
        </nav>
      ) : null}
    </>
  );
}

function Legend() {
  const t = useText();
  return (
    <div className="flex flex-col gap-2 text-meta">
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        {GROUPS.map((group) => (
          <li key={group} className="flex items-center gap-2">
            <span aria-hidden="true" className={`desk-dot desk-dot-${group}`} />
            {t(`desk.map.group.${group}`)}
          </li>
        ))}
      </ul>
      <p className="text-muted">{t("desk.map.legend.cluster")}</p>
    </div>
  );
}

function MapView({ map }: { readonly map: DeskMap }) {
  const t = useText();
  if (map.points.length === 0)
    return (
      <Notice kind="info">
        <p>{t("desk.map.empty")}</p>
      </Notice>
    );
  return (
    <>
      {map.cut ? (
        <Notice kind="info">
          <p>{t("desk.map.cut", { count: map.points.length })}</p>
        </Notice>
      ) : null}
      <noscript>
        <p>{t("desk.map.noscript")}</p>
      </noscript>
      <DeskMapCanvas points={map.points} label={t("desk.map.title")} />
      <Legend />
      <details className="card-surface p-4">
        <summary className="min-h-target cursor-pointer py-2 font-semibold">
          {t("desk.map.table", { count: map.points.length })}
        </summary>
        <ul className="flex flex-col gap-3 pt-2">
          {map.points.map((point) => (
            <li key={point.ticketNumber} className="flex flex-col">
              <Link to={`/lapor/meja/${point.ticketNumber}`} className="font-bold tabular-nums">
                {point.ticketNumber}
              </Link>
              <span>{`${t(`hazard.${point.hazardType}.label`)}, ${t(`stage.short.${point.status}`)}, ${point.villageName}`}</span>
              <span className="text-meta text-muted tabular-nums">
                {`${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}, ${t(`desk.map.precision.${point.precision}`)}`}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

type Photo = DeskGallery["photos"][number];

export function PhotoFigure({ photo }: { readonly photo: Photo }) {
  const t = useText();
  return (
    <figure className="flex flex-col gap-2 card-surface p-2">
      <a href={`/api/lapor/desk/photos/${photo.photoId}`}>
        <img
          src={`/api/lapor/desk/photos/${photo.photoId}`}
          alt={t("desk.gallery.alt", { ticket: photo.ticketNumber })}
          loading="lazy"
          className="aspect-[4/3] w-full rounded-control bg-sunken object-cover"
        />
      </a>
      <figcaption className="flex flex-col gap-1 px-1 pb-1 text-meta">
        <Link to={`/lapor/meja/${photo.ticketNumber}`} className="font-bold tabular-nums">
          {photo.ticketNumber}
        </Link>
        <span className="inline-flex items-center gap-1">
          <Icon name={photo.badge === "none" ? "circleDashed" : "mapPin"} className="size-4" />
          {t(`card.photos.badge.${photo.badge}`)}
        </span>
        {photo.far ? (
          <span className="inline-flex items-center gap-1">
            <Icon name="triangleAlert" className="size-4" />
            {t("card.photos.badge.far")}
          </span>
        ) : null}
        <span className="text-muted tabular-nums">{when(t, "desk.gallery.received", photo.receivedAt)}</span>
      </figcaption>
    </figure>
  );
}

function GalleryView({ gallery }: { readonly gallery: DeskGallery }) {
  const t = useText();
  if (gallery.photos.length === 0)
    return (
      <Notice kind="info">
        <p>{t("desk.gallery.empty")}</p>
      </Notice>
    );
  return (
    <>
      {gallery.cut ? (
        <Notice kind="info">
          <p>{t("desk.gallery.cut", { count: gallery.photos.length })}</p>
        </Notice>
      ) : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {gallery.photos.map((photo) => (
          <li key={photo.photoId}>
            <PhotoFigure photo={photo} />
          </li>
        ))}
      </ul>
    </>
  );
}

const countLine = (t: ReturnType<typeof useText>, shown: DeskShown) =>
  shown.view === "list"
    ? t("desk.count", { count: shown.queue.total })
    : shown.view === "map"
      ? t("desk.map.count", { count: shown.map.points.length })
      : t("desk.gallery.count", { count: shown.gallery.photos.length });

export function DeskQueueView({
  shown,
  summary,
  filters,
  envelope,
}: {
  readonly shown: DeskShown | null;
  readonly summary: DeskSummary | null;
  readonly filters: DeskFilters;
  readonly envelope: ErrorEnvelope | null;
}) {
  const t = useText();
  const account =
    summary?.account.label ??
    (shown === null
      ? ""
      : (shown.view === "list" ? shown.queue : shown.view === "map" ? shown.map : shown.gallery).account.label);
  return (
    <DeskShell place={{ filters, current: { view: filters.view, status: filters.status }, summary }} account={account}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-page font-bold">{t(`desk.heading.${filters.view}`)}</h1>
          <p className="flex flex-wrap items-center gap-2 text-muted">
            {shown === null ? null : <span className="tabular-nums">{countLine(t, shown)}</span>}
            {filters.status === "" ? null : t("desk.heading.queue", { status: `stage.short.${filters.status}` })}
          </p>
        </div>
        <ViewTabs filters={filters} />
      </div>
      <FilterBar filters={filters} summary={summary} envelope={envelope} />
      {shown?.view === "list" ? <ListView queue={shown.queue} filters={filters} /> : null}
      {shown?.view === "map" ? <MapView map={shown.map} /> : null}
      {shown?.view === "gallery" ? <GalleryView gallery={shown.gallery} /> : null}
    </DeskShell>
  );
}
