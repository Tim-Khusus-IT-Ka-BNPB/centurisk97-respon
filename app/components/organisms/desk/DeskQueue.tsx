import { Link } from "react-router";
import type { DeskGallery, DeskQueue, DeskSummary } from "../../../../src/contract/desk";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { cn } from "../../../lib/cn";
import type { DeskFilters, DeskShown } from "../../../lib/deskTypes";
import { hazardIcon } from "../../../lib/hazardIcons";
import { valueLines } from "../../../lib/summary";
import { useText } from "../../../lib/text";
import { buttonStyles } from "../../atoms/Button";
import { Icon } from "../../atoms/Icon";
import { Notice } from "../../molecules/Notice";
import { FilterBar, ViewTabs } from "./DeskFilters";
import { DeskMapView } from "./DeskMap";
import { DeskShell } from "./DeskShell";
import {
  deskLink,
  EmergencyChip,
  eventShort,
  Houses,
  hazardLabel,
  type Item,
  StatusChip,
  Taker,
  UnverifiedMark,
  Victims,
  when,
  whenShort,
} from "./parts";

const placeOf = (t: ReturnType<typeof useText>, item: Item) =>
  t("desk.row.placeShort", { village: item.place.villageName, regency: item.place.regencyName });

export function Hazard({ item }: { readonly item: Pick<Item, "hazardType" | "hazardSubtype" | "emergency"> }) {
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
        <span className="font-semibold">{hazardLabel(t, item)}</span>
        <span className="text-meta text-muted">
          {item.emergency === null ? subtype : t(`desk.emergency.victims.${item.emergency.victims}`)}
        </span>
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
                  <span className="flex flex-wrap gap-1.5">
                    <StatusChip status={item.status} />
                    {item.emergency === null ? null : <EmergencyChip />}
                  </span>
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
                  {item.reporter.name === null ? null : <span>{item.reporter.name}</span>}
                  <span className="text-meta text-muted">{t(`desk.role.${item.reporter.role}`)}</span>
                  {item.numberUnverified ? <UnverifiedMark /> : null}
                  {item.taker === null ? null : <Taker taker={item.taker} />}
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
              <span className="flex flex-wrap justify-end gap-1.5">
                {item.emergency === null ? null : <EmergencyChip />}
                <StatusChip status={item.status} />
              </span>
            </span>
            <Hazard item={item} />
            <span className="text-meta">{placeOf(t, item)}</span>
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Victims impact={item.impact} />
              <Houses impact={item.impact} />
            </span>
            {item.taker === null ? null : <Taker taker={item.taker} />}
            <span className="flex flex-wrap items-center justify-between gap-2 mt-auto border-t border-line pt-2.5 text-meta">
              <span className="flex flex-wrap items-center gap-2">
                <span>{item.reporter.name ?? t(`desk.role.${item.reporter.role}`)}</span>
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

const accountOf = (shown: DeskShown) => (shown.view === "gallery" ? shown.gallery : shown.queue).account.label;

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
  const account = summary?.account.label ?? (shown === null ? "" : accountOf(shown));
  const place = { filters, current: { view: filters.view, status: filters.status }, summary };
  if (filters.view === "map")
    return (
      <DeskShell place={place} account={account} fill>
        <DeskMapView
          map={shown?.view === "map" ? shown.map : null}
          queue={shown?.view === "map" ? shown.queue : null}
          summary={summary}
          filters={filters}
          envelope={envelope}
        />
      </DeskShell>
    );
  return (
    <DeskShell place={place} account={account}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-page font-bold">{t(`desk.heading.${filters.view}`)}</h1>
          <p className="flex flex-wrap items-center gap-2 text-muted">
            {shown?.view === "list" ? (
              <span className="tabular-nums">{t("desk.count", { count: shown.queue.total })}</span>
            ) : null}
            {shown?.view === "gallery" ? (
              <span className="tabular-nums">{t("desk.gallery.count", { count: shown.gallery.photos.length })}</span>
            ) : null}
            {filters.status === "" ? null : t("desk.heading.queue", { status: `stage.short.${filters.status}` })}
          </p>
        </div>
        <ViewTabs filters={filters} />
      </div>
      <FilterBar filters={filters} summary={summary} envelope={envelope} />
      {shown?.view === "list" ? <ListView queue={shown.queue} filters={filters} /> : null}
      {shown?.view === "gallery" ? <GalleryView gallery={shown.gallery} /> : null}
    </DeskShell>
  );
}
