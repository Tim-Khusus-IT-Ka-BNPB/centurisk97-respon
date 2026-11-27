import { Fragment } from "react";
import { Link } from "react-router";
import type { DeskGallery, DeskQueue, DeskSummary } from "../../../../src/contract/desk";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { hazardKey } from "../../../../src/copy/hazardKey";
import { valueLines } from "../../../../src/copy/values";
import { cn } from "../../../lib/cn";
import { foldEvents } from "../../../lib/deskEvents";
import type { DeskFilters, DeskShown } from "../../../lib/deskTypes";
import { hazardIcon } from "../../../lib/hazardIcons";
import { useText } from "../../../lib/text";
import { buttonStyles } from "../../atoms/Button";
import { Icon } from "../../atoms/Icon";
import type { IconName } from "../../atoms/icons";
import { Notice } from "../../molecules/Notice";
import { FilterBar, ViewTabs } from "./DeskFilters";
import { DeskMapView } from "./DeskMap";
import { DeskShell } from "./DeskShell";
import {
  ChatMark,
  ClusterChip,
  clearedLink,
  deskLink,
  EmergencyChip,
  eventShort,
  Impact,
  type Item,
  isFiltered,
  NewsChip,
  OfflineChip,
  OverdueChip,
  roleText,
  StatusChip,
  Taker,
  UnverifiedMark,
  whenShort,
} from "./parts";

const placeOf = (t: ReturnType<typeof useText>, item: Item) =>
  t("desk.row.placeShort", { village: item.place.villageName, regency: item.place.regencyName });

export function Hazard({
  item,
  place = null,
}: {
  readonly item: Pick<Item, "hazardType" | "hazardSubtype" | "emergency">;
  readonly place?: string | null;
}) {
  const t = useText();
  const subtype = valueLines(t, "hazardSubtype", {
    kind: "hazardSubtype",
    hazardType: item.hazardType,
    subtype: item.hazardSubtype,
  })[0];
  return (
    <span className="flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-selected text-primary">
        <Icon name={hazardIcon(item.hazardType)} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-semibold">{t(hazardKey(item.hazardType))}</span>
        <span className="text-meta text-muted">
          {item.emergency === null ? subtype : t(`desk.emergency.victims.${item.emergency.victims}`)}
        </span>
        {place === null ? null : <span className="text-meta">{place}</span>}
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

// The event's other reports on this page, folded under its first: each still opens on its own.
function FoldedMembers({ members }: { readonly members: readonly Item[] }) {
  const t = useText();
  return (
    <details className="group rounded-control border border-line bg-surface">
      <summary className="flex min-h-target-min cursor-pointer list-none items-center gap-2 px-3 text-meta font-semibold [&::-webkit-details-marker]:hidden">
        <Icon
          name="chevronRight"
          className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        {t("desk.cluster.folded", { count: members.length })}
      </summary>
      <ul className="flex flex-col border-t border-line">
        {members.map((member) => (
          <li key={member.ticketNumber}>
            <Link
              to={`/desk/${member.ticketNumber}`}
              className="flex min-h-target-min flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-meta text-ink no-underline hover:bg-sunken"
            >
              <span className="font-bold tabular-nums">{member.ticketNumber}</span>
              <StatusChip status={member.status} />
              <span className="min-w-0 flex-1">{placeOf(t, member)}</span>
              <span className="text-muted tabular-nums">{whenShort(t, member.sentAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

const cell = "border-t border-line px-4 py-3.5 align-top";
const head = "px-4 py-3 text-meta font-semibold text-muted";

// The event takes what the others leave.
const WIDTH = { ticket: "w-44", event: "", impact: "w-58", sent: "w-48", reporter: "w-42" } as const;

// A screen wide enough to leave the event its room reads the queue as a table; the ticket is the
// row's link.
function QueueTable({ items }: { readonly items: readonly Item[] }) {
  const t = useText();
  const events = foldEvents(items);
  return (
    <div className="hidden overflow-x-auto card-surface min-[88rem]:block">
      <table className="w-full table-fixed border-separate border-spacing-0 text-left">
        <thead>
          <tr className="bg-sunken/60">
            {(["ticket", "event", "impact", "sent", "reporter"] as const).map((column) => (
              <th key={column} scope="col" className={cn(head, WIDTH[column])}>
                {t(`desk.col.${column}`)}
              </th>
            ))}
            <th scope="col" className={cn(head, "w-28 text-right")}>
              {t("desk.col.filled")}
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map(({ head: item, members }) => (
            <Fragment key={item.ticketNumber}>
              <tr className="relative hover:bg-sunken/60">
                <td className={cell}>
                  <span className="flex flex-col items-start gap-1.5">
                    <Link
                      to={`/desk/${item.ticketNumber}`}
                      className="font-bold whitespace-nowrap text-ink tabular-nums no-underline after:absolute after:inset-0 hover:underline"
                    >
                      {item.ticketNumber}
                    </Link>
                    <span className="flex flex-wrap gap-1.5">
                      <StatusChip status={item.status} />
                      {item.emergency === null || item.offline?.late ? null : <EmergencyChip />}
                      {item.offline === null ? null : <OfflineChip offline={item.offline} />}
                      {item.news ? <NewsChip /> : null}
                      {item.overdue ? <OverdueChip /> : null}
                      {item.cluster === null ? null : <ClusterChip cluster={item.cluster} />}
                    </span>
                  </span>
                </td>
                <td className={cell}>
                  <Hazard item={item} place={placeOf(t, item)} />
                </td>
                <td className={cell}>
                  <Impact impact={item.impact} />
                </td>
                <td className={cn(cell, "text-meta tabular-nums")}>
                  <span className="flex flex-col gap-0.5">
                    <span>{whenShort(t, item.sentAt)}</span>
                    <span className="text-muted">
                      {t("desk.row.eventTime", { value: eventShort(t, item.eventTime) })}
                    </span>
                  </span>
                </td>
                <td className={cell}>
                  <span className="flex flex-col items-start gap-1">
                    {item.reporter.name === null ? null : <span>{item.reporter.name}</span>}
                    <span className="text-meta text-muted">{roleText(t, item)}</span>
                    {item.numberUnverified ? <UnverifiedMark /> : null}
                    {item.door === "chat" ? <ChatMark /> : null}
                    {item.taker === null ? null : <Taker taker={item.taker} />}
                  </span>
                </td>
                <td className={cn(cell, "text-right")}>
                  <Filled item={item} />
                </td>
              </tr>
              {members.length > 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 pb-3.5">
                    <FoldedMembers members={members} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
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
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2 min-[88rem]:hidden">
      {foldEvents(items).map(({ head: item, members }) => (
        <li key={item.ticketNumber} className="flex flex-col gap-2">
          <Link
            to={`/desk/${item.ticketNumber}`}
            className="flex h-full flex-col gap-2.5 card-surface p-4 text-ink no-underline hover:bg-sunken"
          >
            <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              <span className="font-bold whitespace-nowrap tabular-nums">{item.ticketNumber}</span>
              <span className="flex flex-wrap justify-end gap-1.5">
                {item.emergency === null || item.offline?.late ? null : <EmergencyChip />}
                {item.offline === null ? null : <OfflineChip offline={item.offline} />}
                {item.news ? <NewsChip /> : null}
                {item.overdue ? <OverdueChip /> : null}
                {item.cluster === null ? null : <ClusterChip cluster={item.cluster} />}
                <StatusChip status={item.status} />
              </span>
            </span>
            <Hazard item={item} place={placeOf(t, item)} />
            <Impact impact={item.impact} />
            {item.taker === null ? null : <Taker taker={item.taker} />}
            <span className="flex flex-wrap items-center justify-between gap-2 mt-auto border-t border-line pt-2.5 text-meta">
              <span className="flex flex-wrap items-center gap-2">
                <span>{item.reporter.name ?? roleText(t, item)}</span>
                {item.numberUnverified ? <UnverifiedMark /> : null}
                {item.door === "chat" ? <ChatMark /> : null}
              </span>
              <span className="text-muted tabular-nums">{whenShort(t, item.sentAt)}</span>
            </span>
          </Link>
          {members.length > 0 ? <FoldedMembers members={members} /> : null}
        </li>
      ))}
    </ul>
  );
}

// Nothing to show: what that means, and while something is filtered the way back to everything.
function Empty({
  icon,
  text,
  filters,
}: {
  readonly icon: IconName;
  readonly text: string;
  readonly filters: DeskFilters;
}) {
  const t = useText();
  return (
    <div className="flex flex-col items-center gap-4 card-surface px-6 py-14 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-sunken text-muted">
        <Icon name={icon} className="size-7" />
      </span>
      <p className="max-w-[44ch] text-muted">{text}</p>
      {isFiltered(filters) ? (
        <Link to={clearedLink(filters)} className={buttonStyles({ variant: "primary" })}>
          {t("desk.empty.all")}
        </Link>
      ) : null}
    </div>
  );
}

function ListView({ queue, filters }: { readonly queue: DeskQueue; readonly filters: DeskFilters }) {
  const t = useText();
  if (queue.items.length === 0)
    return <Empty icon="inbox" text={t(isFiltered(filters) ? "desk.empty" : "desk.empty.none")} filters={filters} />;
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

export function PhotoFigure({
  photo,
  own = false,
}: {
  readonly photo: Photo;
  // On its own report's page: no card of its own, and no way to where one already is.
  readonly own?: boolean;
}) {
  const t = useText();
  return (
    <figure className={cn("flex flex-col gap-2", own ? "" : "card-surface p-2")}>
      <a href={`/api/desk/photos/${photo.photoId}`} className="group rounded-control">
        <img
          src={`/api/desk/photos/${photo.photoId}`}
          alt={t("desk.gallery.alt", { ticket: photo.ticketNumber })}
          loading="lazy"
          className="aspect-[4/3] w-full rounded-control bg-sunken object-cover transition-opacity duration-150 group-hover:opacity-90 motion-reduce:transition-none"
        />
      </a>
      <figcaption className={cn("flex flex-col gap-1 text-meta", own ? "" : "px-1 pb-1")}>
        {own ? null : (
          <Link
            to={`/desk/${photo.ticketNumber}`}
            className="inline-flex min-h-target-min items-center font-bold tabular-nums"
          >
            {photo.ticketNumber}
          </Link>
        )}
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
        {photo.doubts.length > 0 ? (
          <span
            title={photo.doubts.map((doubt) => t(`desk.gps.${doubt}`)).join(" ")}
            className="inline-flex w-fit items-center gap-1 rounded-chip bg-warn-tint px-1.5 py-0.5 font-semibold text-ink"
          >
            <Icon name="triangleAlert" className="size-4 text-warn-icon" />
            {t("desk.gps.doubt")}
          </span>
        ) : null}
        <span className="text-muted tabular-nums">{whenShort(t, photo.receivedAt)}</span>
      </figcaption>
    </figure>
  );
}

function GalleryView({ gallery, filters }: { readonly gallery: DeskGallery; readonly filters: DeskFilters }) {
  const t = useText();
  if (gallery.photos.length === 0)
    return (
      <Empty
        icon="images"
        text={t(isFiltered(filters) ? "desk.gallery.empty" : "desk.gallery.empty.none")}
        filters={filters}
      />
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
      {shown === null ? <Empty icon="search" text={t("desk.refusedSearch")} filters={filters} /> : null}
      {shown?.view === "list" ? <ListView queue={shown.queue} filters={filters} /> : null}
      {shown?.view === "gallery" ? <GalleryView gallery={shown.gallery} filters={filters} /> : null}
    </DeskShell>
  );
}
