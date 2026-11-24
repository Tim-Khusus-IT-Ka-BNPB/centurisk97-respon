import { type ReactNode, useEffect } from "react";
import { Form, Link, useNavigation, useSubmit } from "react-router";
import type { DeskGallery, DeskMap, DeskQueue, DeskReport } from "../../../src/contract/desk";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import { DESK_PERIODS } from "../../../src/domain/deskQueue";
import { HAZARD_TYPE_IDS } from "../../../src/domain/hazards";
import { GROUPS } from "../../lib/deskMap";
import { DESK_VIEWS, type DeskFilters, type DeskShown } from "../../lib/deskTypes";
import { problemOf } from "../../lib/envelope";
import { useFocusOnChange } from "../../lib/hooks";
import { limitText } from "../../lib/status";
import { hazardOf, rowView, valueLines } from "../../lib/summary";
import { useText } from "../../lib/text";
import { clockTime, type Instant, longDate } from "../../lib/time";
import { Button, buttonStyles } from "../atoms/Button";
import { Input, Label, Select } from "../atoms/controls";
import { Icon } from "../atoms/Icon";
import { Field } from "../molecules/Field";
import { Notice } from "../molecules/Notice";
import { Panel } from "../molecules/Panel";
import { SummaryRow } from "./cards/SummaryCards";
import { DeskMapCanvas } from "./DeskMapCanvas";

const STATUSES = ["new", "seen", "under_review", "forwarded", "in_handling", "closed", "invalid"] as const;

type Item = DeskQueue["items"][number];

const when = (t: ReturnType<typeof useText>, key: string, instant: Instant) =>
  t(key, { date: longDate(instant), time: clockTime(instant), zone: instant.zone });

// "+6280000000001" as "+62 800-0000-0001": grouped to read aloud on the phone.
export const spacedNumber = (stored: string) => `+62 ${stored.slice(3, 6)}-${stored.slice(6, 10)}-${stored.slice(10)}`;

function StatusChip({ status }: { readonly status: Item["status"] }) {
  const t = useText();
  return (
    <span className="inline-flex items-center gap-1 rounded-chip border border-control px-1.5 text-meta font-semibold">
      <Icon name={status === "new" ? "circleDot" : status === "closed" ? "circleCheck" : "circle"} className="size-4" />
      {t(`stage.short.${status}`)}
    </span>
  );
}

function UnverifiedChip() {
  const t = useText();
  return (
    <span className="inline-flex items-center gap-1 rounded-chip border border-dashed border-control px-1.5 text-meta">
      <Icon name="triangleAlert" className="size-4" />
      {t("desk.unverified")}
    </span>
  );
}

// The account and a way out, above every desk page.
function DeskHeading({ label, children }: { readonly label: string; readonly children?: ReactNode }) {
  const t = useText();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-page font-bold">{t("desk.title")}</h1>
        <p className="text-muted">{t("desk.account", { label })}</p>
        {children}
      </div>
      <Form method="post" action="/lapor/meja">
        <input type="hidden" name="action" value="signOut" />
        <Button variant="secondary">{t("desk.signOut")}</Button>
      </Form>
    </div>
  );
}

export function DeskSignIn({ envelope }: { readonly envelope: ErrorEnvelope | null }) {
  const t = useText();
  const busy = useNavigation().state === "submitting";
  const problem = problemOf(envelope, "code");
  useFocusOnChange(problem === null ? null : "code", envelope);
  return (
    <Panel
      id="desk-sign-in"
      title={t("desk.signIn.title")}
      lead={t("desk.signIn.lead")}
      focusHeading={problem === null}
    >
      {envelope !== null && problem === null ? (
        <Notice kind={envelope.error.code.startsWith("limit.") ? "limit" : "error"}>
          <p>{limitText(t, envelope, Date.now())}</p>
        </Notice>
      ) : null}
      <Form method="post" action="/lapor/meja" className="flex flex-col gap-4">
        <input type="hidden" name="action" value="signIn" />
        <Field
          id="code"
          label={t("desk.signIn.code")}
          hint={t("desk.signIn.codeHint")}
          problem={problem}
          focus={problem !== null}
        >
          {(control) => <Input {...control} type="password" autoComplete="off" required />}
        </Field>
        <Button variant="primary" size="main" busyLabel={busy ? t("desk.signIn.busy") : null}>
          {t("desk.signIn.submit")}
        </Button>
      </Form>
    </Panel>
  );
}

// A refused read: what the envelope says, and the way back to the list.
export function DeskRefused({ envelope }: { readonly envelope: ErrorEnvelope }) {
  const t = useText();
  return (
    <Panel id="desk-refused" title={t("desk.refused.title")}>
      <Notice kind={envelope.error.code.startsWith("limit.") ? "limit" : "error"}>
        <p>{limitText(t, envelope, Date.now())}</p>
      </Notice>
      <Link to="/lapor/meja" className={buttonStyles({ variant: "secondary" })}>
        {t("desk.refused.back")}
      </Link>
    </Panel>
  );
}

function FilterSelect({
  id,
  label,
  value,
  all,
  options,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly all: string | null;
  readonly options: readonly (readonly [string, string])[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} name={id} defaultValue={value}>
        {all === null ? null : <option value="">{all}</option>}
        {options.map(([optionValue, text]) => (
          <option key={optionValue} value={optionValue}>
            {text}
          </option>
        ))}
      </Select>
    </div>
  );
}

function Filters({ filters, envelope }: { readonly filters: DeskFilters; readonly envelope: ErrorEnvelope | null }) {
  const t = useText();
  const problem = problemOf(envelope, "ticket");
  useFocusOnChange(problem === null ? null : "ticket", envelope);
  return (
    <Form method="get" role="search" aria-label={t("desk.filters")} className="@container card-surface p-4">
      <input type="hidden" name="view" value={filters.view} />
      <div className="grid grid-cols-1 items-end gap-x-3 gap-y-4 @[19rem]:grid-cols-2 @[60rem]:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <FilterSelect
          id="status"
          label={t("desk.filter.status")}
          value={filters.status}
          all={t("desk.filter.allStatuses")}
          options={STATUSES.map((status) => [status, t(`stage.short.${status}`)])}
        />
        <FilterSelect
          id="hazardType"
          label={t("desk.filter.hazard")}
          value={filters.hazardType}
          all={t("desk.filter.allHazards")}
          options={HAZARD_TYPE_IDS.map((id) => [id, t(`hazard.${id}.label`)])}
        />
        <FilterSelect
          id="period"
          label={t("desk.filter.period")}
          value={filters.period}
          all={null}
          options={DESK_PERIODS.map((period) => [period, t(`desk.period.${period}`)])}
        />
        <Field id="ticket" label={t("desk.filter.ticket")} problem={problem} focus={problem !== null}>
          {(control) => (
            <Input
              {...control}
              defaultValue={filters.ticket}
              placeholder={t("desk.filter.ticketHint")}
              autoComplete="off"
            />
          )}
        </Field>
        <div className="flex flex-wrap items-center gap-3 @[19rem]:col-span-2 @[60rem]:col-span-1">
          <Button variant="primary">{t("desk.filter.apply")}</Button>
          <Link to="/lapor/meja" className={buttonStyles({ variant: "quiet" })}>
            {t("desk.filter.clear")}
          </Link>
        </div>
      </div>
    </Form>
  );
}

function QueueRow({ item }: { readonly item: Item }) {
  const t = useText();
  const subtype = valueLines(t, "hazardSubtype", {
    kind: "hazardSubtype",
    hazardType: item.hazardType,
    subtype: item.hazardSubtype,
  })[0];
  const eventTime = t("desk.row.eventTime", {
    value: valueLines(t, "eventTime", { kind: "eventTime", time: item.eventTime })[0] as string,
  });
  return (
    <li>
      <Link
        to={`/lapor/meja/${item.ticketNumber}`}
        className="grid gap-2 rounded-control border border-line bg-surface p-4 text-ink no-underline hover:bg-[color-mix(in_oklch,var(--surface),var(--ink)_4%)] lg:grid-cols-[11rem_minmax(0,1fr)_16rem] lg:gap-6"
      >
        <span className="flex flex-col items-start gap-2">
          <span className="font-bold tabular-nums">{item.ticketNumber}</span>
          <StatusChip status={item.status} />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-semibold">{`${t(`hazard.${item.hazardType}.label`)}, ${subtype}`}</span>
          <span>
            {t("desk.row.place", {
              village: item.place.villageName,
              district: item.place.districtName,
              regency: item.place.regencyName,
            })}
          </span>
          <span className="text-meta text-muted">{eventTime}</span>
          <span className="text-meta text-muted tabular-nums">{when(t, "desk.row.sentAt", item.sentAt)}</span>
        </span>
        <span className="flex min-w-0 flex-col items-start gap-1">
          <span>
            {item.reporter.name}, {t(`desk.role.${item.reporter.role}`)}
          </span>
          {item.numberUnverified ? <UnverifiedChip /> : null}
          <span className="text-meta text-muted tabular-nums">
            {t("desk.row.complete", { percent: item.completePercent })},{" "}
            {t("desk.row.photos", { count: item.photoCount })}
          </span>
        </span>
      </Link>
    </li>
  );
}

// The desk's address for these filters; the list view and the first page are left out.
const deskLink = (filters: DeskFilters, change: Partial<DeskFilters>) => {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...filters, ...change }))
    if (value !== "" && value !== 1 && value !== "list") search.set(name, String(value));
  const text = search.toString();
  return text === "" ? "/lapor/meja" : `/lapor/meja?${text}`;
};

function ViewTabs({ filters }: { readonly filters: DeskFilters }) {
  const t = useText();
  return (
    <nav aria-label={t("desk.views")} className="flex flex-wrap gap-2">
      {DESK_VIEWS.map((view) => (
        <Link
          key={view}
          to={deskLink(filters, { view, page: 1 })}
          aria-current={filters.view === view ? "page" : undefined}
          className={buttonStyles({
            variant: filters.view === view ? "primary" : "secondary",
            className: "min-w-24",
          })}
        >
          {t(`desk.view.${view}`)}
        </Link>
      ))}
    </nav>
  );
}

function ListView({ queue, filters }: { readonly queue: DeskQueue; readonly filters: DeskFilters }) {
  const t = useText();
  return (
    <section aria-labelledby="desk-list" className="flex flex-col gap-3">
      <h2 id="desk-list" className="text-card font-bold">
        {t("desk.list")} <span className="font-normal text-muted">{t("desk.count", { count: queue.total })}</span>
      </h2>
      {queue.items.length === 0 ? (
        <Notice kind="info">
          <p>{t("desk.empty")}</p>
        </Notice>
      ) : (
        <ul className="flex flex-col gap-3">
          {queue.items.map((item) => (
            <QueueRow key={item.ticketNumber} item={item} />
          ))}
        </ul>
      )}
      {queue.pageCount > 1 ? (
        <nav
          aria-label={t("desk.page", { page: queue.page, pages: queue.pageCount })}
          className="flex flex-wrap items-center gap-3"
        >
          {queue.page > 1 ? (
            <Link to={deskLink(filters, { page: queue.page - 1 })} className={buttonStyles({ variant: "secondary" })}>
              {t("desk.previous")}
            </Link>
          ) : null}
          <span className="text-muted">{t("desk.page", { page: queue.page, pages: queue.pageCount })}</span>
          {queue.page < queue.pageCount ? (
            <Link to={deskLink(filters, { page: queue.page + 1 })} className={buttonStyles({ variant: "secondary" })}>
              {t("desk.next")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}

function Legend() {
  const t = useText();
  return (
    <div className="flex flex-col gap-2 text-meta">
      <p className="font-semibold">{t("desk.map.legend.status")}</p>
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        {GROUPS.map((group) => (
          <li key={group} className="flex items-center gap-2">
            <span aria-hidden="true" className={`desk-marker desk-marker-${group} size-6! border-2!`} />
            {t(`desk.map.group.${group}`)}
          </li>
        ))}
      </ul>
      <p className="text-muted">{t("desk.map.legend.hazard")}</p>
      <p className="text-muted">{t("desk.map.legend.cluster")}</p>
    </div>
  );
}

function MapView({ map }: { readonly map: DeskMap }) {
  const t = useText();
  return (
    <section aria-labelledby="desk-map" className="flex flex-col gap-3">
      <h2 id="desk-map" className="text-card font-bold">
        {t("desk.map.title")}{" "}
        <span className="font-normal text-muted">{t("desk.map.count", { count: map.points.length })}</span>
      </h2>
      {map.cut ? (
        <Notice kind="info">
          <p>{t("desk.map.cut", { count: map.points.length })}</p>
        </Notice>
      ) : null}
      {map.points.length === 0 ? (
        <Notice kind="info">
          <p>{t("desk.map.empty")}</p>
        </Notice>
      ) : (
        <>
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
                  <span>
                    {`${t(`hazard.${point.hazardType}.label`)}, ${t(`stage.short.${point.status}`)}, ${point.villageName}`}
                  </span>
                  <span className="text-meta text-muted tabular-nums">
                    {`${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}, ${t(`desk.map.precision.${point.precision}`)}`}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}

type Photo = DeskGallery["photos"][number];

function PhotoFigure({ photo }: { readonly photo: Photo }) {
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

const PHOTO_GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4";

function GalleryView({ gallery }: { readonly gallery: DeskGallery }) {
  const t = useText();
  return (
    <section aria-labelledby="desk-gallery" className="flex flex-col gap-3">
      <h2 id="desk-gallery" className="text-card font-bold">
        {t("desk.gallery.title")}{" "}
        <span className="font-normal text-muted">{t("desk.gallery.count", { count: gallery.photos.length })}</span>
      </h2>
      {gallery.cut ? (
        <Notice kind="info">
          <p>{t("desk.gallery.cut", { count: gallery.photos.length })}</p>
        </Notice>
      ) : null}
      {gallery.photos.length === 0 ? (
        <Notice kind="info">
          <p>{t("desk.gallery.empty")}</p>
        </Notice>
      ) : (
        <ul className={PHOTO_GRID}>
          {gallery.photos.map((photo) => (
            <li key={photo.photoId}>
              <PhotoFigure photo={photo} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DeskQueueView({
  shown,
  filters,
  envelope,
}: {
  readonly shown: DeskShown | null;
  readonly filters: DeskFilters;
  readonly envelope: ErrorEnvelope | null;
}) {
  const t = useText();
  const label =
    shown === null
      ? ""
      : (shown.view === "list" ? shown.queue : shown.view === "map" ? shown.map : shown.gallery).account.label;
  return (
    <>
      <DeskHeading label={label}>
        <p>{t("desk.lead")}</p>
      </DeskHeading>
      <ViewTabs filters={filters} />
      <Filters filters={filters} envelope={envelope} />
      {shown?.view === "list" ? <ListView queue={shown.queue} filters={filters} /> : null}
      {shown?.view === "map" ? <MapView map={shown.map} /> : null}
      {shown?.view === "gallery" ? <GalleryView gallery={shown.gallery} /> : null}
    </>
  );
}

function Origin({ origin, quote }: { readonly origin: string | null; readonly quote: string | null }) {
  const t = useText();
  if (origin === null) return null;
  return (
    <p className="text-meta text-muted">
      {t(`desk.origin.${origin}`)}
      {quote === null ? null : <q className="ms-1 text-ink">{quote}</q>}
    </p>
  );
}

// With script the open is posted once per visit; without, the officer marks it.
function MarkSeen({ report }: { readonly report: DeskReport }) {
  const t = useText();
  const submit = useSubmit();
  const busy = useNavigation().state === "submitting";
  useEffect(() => {
    submit(null, {
      method: "post",
      action: `/lapor/meja/${report.ticketNumber}`,
      replace: true,
      preventScrollReset: true,
    });
  }, [report.ticketNumber, submit]);
  if (report.status !== "new") return null;
  return (
    <Form method="post" replace preventScrollReset className="flex flex-col gap-2">
      <p className="text-meta text-muted">{t("desk.markSeen.hint")}</p>
      <Button variant="primary" busyLabel={busy ? t("desk.markSeen.busy") : null}>
        {t("desk.markSeen")}
      </Button>
    </Form>
  );
}

export function DeskReportView({ report }: { readonly report: DeskReport }) {
  const t = useText();
  const hazardType = hazardOf(report.groups);
  return (
    <>
      <DeskHeading label={report.account.label}>
        <Link to="/lapor/meja" className={buttonStyles({ variant: "quiet", className: "self-start" })}>
          <Icon name="arrowLeft" className="size-5" />
          {t("desk.back")}
        </Link>
      </DeskHeading>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="desk-report" className="flex flex-col gap-3 card-surface p-4 md:p-5">
            <h2 id="desk-report" className="text-ticket font-bold tabular-nums">
              {report.ticketNumber}
            </h2>
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-muted">{t("desk.status")}</span>
              <StatusChip status={report.status} />
            </p>
            <p className="text-meta text-muted tabular-nums">{when(t, "desk.row.sentAt", report.sentAt)}</p>
            <MarkSeen report={report} />
          </section>
          <section aria-labelledby="desk-photos" className="flex flex-col gap-3 card-surface p-4 md:p-5">
            <h2 id="desk-photos" className="text-card font-bold">
              {t("desk.photos")}
            </h2>
            {report.photos.length === 0 ? (
              <p className="text-muted">{t("desk.photos.empty")}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {report.photos.map((photo) => (
                  <li key={photo.photoId}>
                    <PhotoFigure photo={photo} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="desk-values" className="flex flex-col gap-4 card-surface p-4 md:p-5">
            <h2 id="desk-values" className="text-card font-bold">
              {t("desk.values")}{" "}
              <span className="font-normal text-muted">{t("desk.complete", { percent: report.completePercent })}</span>
            </h2>
            {report.groups.map((group) => (
              <div key={group.groupId} className="flex flex-col gap-2">
                <h3 className="font-bold">{t(`group.${group.groupId}.label`)}</h3>
                <ul className="flex flex-col gap-3">
                  {group.rows.map((row) => (
                    <li key={row.fieldId} className="flex flex-col gap-0.5">
                      <ul>
                        <SummaryRow view={rowView(t, row, hazardType)} />
                      </ul>
                      <Origin origin={row.state === "notYetKnown" ? null : row.origin} quote={row.quote} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="desk-reporter" className="flex flex-col gap-2 card-surface p-4 md:p-5">
            <h2 id="desk-reporter" className="text-card font-bold">
              {t("desk.reporter")}
            </h2>
            <p className="font-semibold">{report.reporter.name}</p>
            <p>{t(`desk.role.${report.reporter.role}`)}</p>
            {report.reporter.officerRegency !== null ? (
              <p>
                {t("desk.reporter.officer", {
                  regency: report.reporter.officerRegency,
                  position: report.reporter.officerPosition as string,
                })}
              </p>
            ) : null}
            <p className="text-meta text-muted">{t("desk.reporter.number")}</p>
            <a
              href={`tel:${report.reporter.number}`}
              className={buttonStyles({ variant: "secondary", className: "self-start tabular-nums" })}
            >
              <Icon name="phone" className="size-5" />
              {t("desk.reporter.call", { number: spacedNumber(report.reporter.number) })}
            </a>
            {report.numberUnverified ? (
              <div className="flex flex-col items-start gap-1">
                <UnverifiedChip />
                <p className="text-meta text-muted">{t("desk.reporter.unverifiedHint")}</p>
              </div>
            ) : null}
          </section>
          <section aria-labelledby="desk-history" className="flex flex-col gap-2 card-surface p-4 md:p-5">
            <h2 id="desk-history" className="text-card font-bold">
              {t("desk.history")}
            </h2>
            <ol className="flex flex-col gap-3">
              {report.history.map((entry) => (
                <li key={`${entry.status}-${entry.at.utc}`} className="flex flex-col">
                  <span className="font-semibold">{t(`stage.long.${entry.status}`)}</span>
                  <span className="text-meta text-muted tabular-nums">{when(t, "desk.history.at", entry.at)}</span>
                  <span className="text-meta">{entry.actor ?? t("desk.history.system")}</span>
                  {entry.note === null ? null : <span>{entry.note}</span>}
                </li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="desk-words" className="flex flex-col gap-2 card-surface p-4 md:p-5">
            <h2 id="desk-words" className="text-card font-bold">
              {t("desk.words")}
            </h2>
            {report.reporterWords.length === 0 ? (
              <p className="text-muted">{t("desk.words.empty")}</p>
            ) : (
              <details>
                <summary className="min-h-target cursor-pointer py-2 font-semibold">
                  {t("desk.words.show", { count: report.reporterWords.length })}
                </summary>
                <ol className="flex flex-col gap-3">
                  {report.reporterWords.map((word, index) => (
                    // Answers of one minute share a time, so their order is their key.
                    // biome-ignore lint/suspicious/noArrayIndexKey: the list is append-only and never reordered
                    <li key={index} className="flex flex-col">
                      <q>{word.text}</q>
                      <span className="text-meta text-muted tabular-nums">{when(t, "desk.history.at", word.at)}</span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
