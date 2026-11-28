import type { DeskQueue } from "../../../../src/contract/desk";
import type { Text } from "../../../../src/copy/text";
import {
  clockTime,
  type Instant,
  localClockText,
  localShortDate,
  longDate,
  shortDate,
} from "../../../../src/copy/time";
import { cn } from "../../../lib/cn";
import { STATUS_GROUPS } from "../../../lib/deskMap";
import type { DeskFilters } from "../../../lib/deskTypes";
import { useText } from "../../../lib/text";
import { Icon } from "../../atoms/Icon";
import type { IconName } from "../../atoms/icons";

export const STATUSES = ["new", "seen", "under_review", "forwarded", "in_handling", "closed", "invalid"] as const;
export type Status = (typeof STATUSES)[number];
export type Item = DeskQueue["items"][number];

export const when = (t: Text, key: string, instant: Instant) =>
  t(key, { date: longDate(instant), time: clockTime(instant), zone: instant.zone });

// The same in a dense list: "25 Nov 2026, 06.29 WIB".
export const whenShort = (t: Text, instant: Instant) =>
  t("desk.row.sentShort", { date: shortDate(instant), time: clockTime(instant), zone: instant.zone });

// The event's time as the reporter gave it, short: with its hour when known.
export function eventShort(t: Text, time: Item["eventTime"]): string {
  if (time.kind === "olderThan30Days") return t("value.eventTime.olderThan30Days");
  const date = localShortDate(time.localDate);
  return time.kind === "dateOnly"
    ? date
    : t("desk.row.eventAt", { date, time: localClockText(time.localTime), zone: time.zone });
}

// "+6280000000001" as "+62 800-0000-0001": grouped to read aloud on the phone.
export const spacedNumber = (stored: string) => `+62 ${stored.slice(3, 6)}-${stored.slice(6, 10)}-${stored.slice(10)}`;

// The desk's address for these filters; the map view, an empty filter and the first page are left out.
export function deskLink(filters: DeskFilters, change: Partial<DeskFilters> = {}): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...filters, ...change }))
    if (value !== "" && value !== 1 && value !== "map" && !(name === "period" && value === "all"))
      search.set(name, String(value));
  const text = search.toString();
  return text === "" ? "/desk" : `/desk?${text}`;
}

// The desk with nothing filtered: what the side menu leads to from a page that is not a queue.
export const ALL_FILTERS: DeskFilters = {
  view: "map",
  status: "",
  hazardType: "",
  period: "all",
  ticket: "",
  has: "",
  page: 1,
};

// Who has a report in hand.
export function Taker({ taker }: { readonly taker: string }) {
  const t = useText();
  return (
    <span className="inline-flex items-start gap-1.5 text-meta">
      <Icon name="circleCheck" className="mt-0.5 size-4 shrink-0 text-primary" />
      <span className="min-w-0 break-words">{t("desk.taker", { taker })}</span>
    </span>
  );
}

// The same view with no filter but it.
export const clearedLink = ({ view }: DeskFilters) =>
  deskLink({ view, status: "", hazardType: "", period: "all", ticket: "", has: "", page: 1 });

export const isFiltered = (filters: DeskFilters) => clearedLink(filters) !== deskLink(filters, { page: 1 });

// A status's group colour as a dot; the words beside it carry the meaning.
export function StatusDot({ status }: { readonly status: Status }) {
  return <span aria-hidden="true" className={`desk-dot desk-dot-${STATUS_GROUPS[status]}`} />;
}

export function StatusChip({ status }: { readonly status: Status }) {
  const t = useText();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-chip border border-line bg-surface px-2 py-0.5 text-meta font-semibold">
      <StatusDot status={status} />
      {t(`stage.short.${status}`)}
    </span>
  );
}

// The same mark in a list row: an icon and short words, without a box.
export function UnverifiedMark() {
  const t = useText();
  return (
    <span className="inline-flex items-start gap-1 text-meta text-warn-icon">
      <Icon name="triangleAlert" className="mt-0.5 size-4" />
      {t("desk.unverifiedShort")}
    </span>
  );
}

// Who reported, by role.
export const roleText = (t: Text, item: { readonly reporter: Pick<Item["reporter"], "role"> }): string =>
  t(`desk.role.${item.reporter.role}`);

// Raised as an emergency; the words carry it, the colour repeats it.
export function EmergencyChip() {
  const t = useText();
  return (
    <span className="inline-flex items-center gap-1 rounded-chip bg-signal px-1.5 py-0.5 text-meta font-bold whitespace-nowrap text-on-signal">
      <Icon name="triangleAlert" className="size-4" />
      {t("desk.emergency.chip")}
    </span>
  );
}

// A report kept on the reporter's phone with no signal: from offline, or more than 2 hours late, with
// when the phone saved it as a note (LR-09).
export function OfflineChip({ offline }: { readonly offline: NonNullable<Item["offline"]> }) {
  const t = useText();
  const saved = offline.savedAt === null ? t("desk.offline.noClock") : when(t, "desk.offline.saved", offline.savedAt);
  return (
    <span
      title={saved}
      className="inline-flex items-center gap-1 rounded-chip border border-line bg-surface px-2 py-0.5 text-meta whitespace-nowrap"
    >
      <Icon name="clock" className="size-4" />
      {t(offline.late ? "desk.offline.late" : "desk.offline.chip")}
      <span className="sr-only">, {saved}</span>
    </span>
  );
}

// The reporter added something no officer has acted on yet.
export function NewsChip() {
  const t = useText();
  return (
    <span className="inline-flex items-center gap-1 rounded-chip bg-selected px-1.5 py-0.5 text-meta font-semibold whitespace-nowrap text-primary">
      <Icon name="messageSquare" className="size-4" />
      {t("desk.news.chip")}
    </span>
  );
}

// Still open after a week in one status (Q40): the word says it, the colour only repeats it.
export function OverdueChip() {
  const t = useText();
  return (
    <span
      title={t("desk.overdue.hint")}
      className="inline-flex items-center gap-1 rounded-chip bg-warn-tint px-1.5 py-0.5 text-meta font-semibold whitespace-nowrap text-ink"
    >
      <Icon name="clock" className="size-4 text-warn-icon" />
      {t("desk.overdue")}
    </span>
  );
}

// The report is one of a cluster: the same hazard close in place and time from other numbers. A
// cluster is never called verified.
export function ClusterChip({ cluster }: { readonly cluster: NonNullable<Item["cluster"]> }) {
  const t = useText();
  return (
    <span className="inline-flex items-center gap-1 rounded-chip border border-line bg-surface px-2 py-0.5 text-meta whitespace-nowrap">
      <Icon name="users" className="size-4" />
      {t(cluster.strong ? "desk.cluster.strong" : "desk.cluster.chip", { count: cluster.tickets.length })}
      {cluster.sameVillage ? <span className="text-muted">, {t("desk.cluster.sameVillage")}</span> : null}
    </span>
  );
}

export function UnverifiedChip() {
  const t = useText();
  return (
    <span className="inline-flex items-center gap-1 rounded-chip border border-dashed border-control px-2 py-0.5 text-meta">
      <Icon name="triangleAlert" className="size-4" />
      {t("desk.unverified")}
    </span>
  );
}

const IMPACT = [
  ["dead", "heartCrack"],
  ["missing", "userSearch"],
  ["injured", "bandage"],
  ["displaced", "tent"],
  ["houses", "house"],
] as const satisfies readonly (readonly [keyof Item["impact"], IconName])[];

type ImpactFigure = {
  readonly field: (typeof IMPACT)[number][0];
  readonly icon: IconName;
  readonly count: number | null;
  // At least this many: part of what makes it up is not known yet.
  readonly partial: boolean;
};

const figuresOf = (impact: Item["impact"]): readonly ImpactFigure[] =>
  IMPACT.map(([field, icon]) =>
    field === "houses"
      ? { field, icon, count: impact.houses?.count ?? null, partial: impact.houses?.partial ?? false }
      : { field, icon, count: impact[field], partial: false },
  );

const countText = ({ count, partial }: ImpactFigure) => `${count?.toLocaleString("id-ID")}${partial ? "+" : ""}`;

// What a report counts, in words: the figures above zero. With none of them, an explicit none and
// a figure not known yet are told apart.
export function Impact({ impact }: { readonly impact: Item["impact"] }) {
  const t = useText();
  const figures = figuresOf(impact);
  const above = figures.filter((one) => one.count);
  if (above.length === 0) {
    const unknown = figures.filter((one) => one.count === null).length;
    const told = unknown === 0 ? "none" : unknown === figures.length ? "unknown" : "some";
    return <span className="text-meta text-muted">{t(`desk.impact.told.${told}`)}</span>;
  }
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 text-meta">
      {above.map((one) => (
        <span key={one.field} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Icon name={one.icon} className="size-4 text-muted" />
          <span>
            <span className="font-semibold tabular-nums">{countText(one)}</span> {t(`desk.impact.word.${one.field}`)}
          </span>
        </span>
      ))}
    </span>
  );
}

// The same figures on the report itself, every one of them, known or not.
export function ImpactStrip({ impact }: { readonly impact: Item["impact"] }) {
  const t = useText();
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-6 lg:grid-cols-5">
      {figuresOf(impact).map((one) => (
        <div
          key={one.field}
          className="flex flex-col-reverse justify-end gap-0.5 bg-surface px-4 py-3 max-sm:last:col-span-2 sm:max-lg:col-span-2 sm:max-lg:nth-[n+4]:col-span-3"
        >
          <dt className="flex items-center gap-1.5 text-meta text-muted">
            <Icon name={one.icon} className="size-4" />
            {t(`desk.impact.${one.field}`)}
          </dt>
          <dd className={cn("flex min-h-8 items-end tabular-nums", one.count ? "text-page font-bold" : "text-muted")}>
            {one.count === null ? t("desk.impact.unknown") : one.count === 0 ? t("desk.impact.none") : countText(one)}
            {one.partial ? <span className="sr-only">, {t("desk.impact.partial")}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
