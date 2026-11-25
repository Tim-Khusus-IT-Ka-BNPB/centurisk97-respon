import type { DeskQueue } from "../../../../src/contract/desk";
import { cn } from "../../../lib/cn";
import { STATUS_GROUPS } from "../../../lib/deskMap";
import type { DeskFilters } from "../../../lib/deskTypes";
import type { Text } from "../../../lib/text";
import { useText } from "../../../lib/text";
import { clockTime, type Instant, localClockText, localShortDate, longDate, shortDate } from "../../../lib/time";
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

// The desk's address for these filters; the list view, an empty filter and the first page are left out.
export function deskLink(filters: DeskFilters, change: Partial<DeskFilters> = {}): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...filters, ...change }))
    if (value !== "" && value !== 1 && value !== "list" && !(name === "period" && value === "all"))
      search.set(name, String(value));
  const text = search.toString();
  return text === "" ? "/lapor/meja" : `/lapor/meja?${text}`;
}

// A status's group colour as a dot; the words beside it carry the meaning.
export function StatusDot({ status }: { readonly status: Status }) {
  return <span aria-hidden="true" className={`desk-dot desk-dot-${STATUS_GROUPS[status]}`} />;
}

export function StatusChip({ status }: { readonly status: Status }) {
  const t = useText();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-chip border border-line bg-surface px-1.5 py-0.5 text-meta font-semibold whitespace-nowrap">
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

export function UnverifiedChip() {
  const t = useText();
  return (
    <span className="inline-flex items-center gap-1 rounded-chip border border-dashed border-control px-1.5 py-0.5 text-meta whitespace-nowrap">
      <Icon name="triangleAlert" className="size-4" />
      {t("desk.unverified")}
    </span>
  );
}

const IMPACT: readonly (readonly [keyof Omit<Item["impact"], "houses">, IconName])[] = [
  ["dead", "heartCrack"],
  ["missing", "userSearch"],
  ["injured", "bandage"],
  ["displaced", "tent"],
];

// One figure with its icon. Not known reads as a dash and says so to a screen reader; an
// explicit none is a quiet 0; a count stands out.
function Figure({
  icon,
  label,
  count,
  unit,
  partial = false,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly count: number | null;
  readonly unit: string;
  // At least this many: part of what makes it up is not known yet.
  readonly partial?: boolean;
}) {
  const t = useText();
  const counted =
    count === null
      ? t("desk.impact.unknown")
      : count === 0
        ? t("desk.impact.none")
        : `${count.toLocaleString("id-ID")} ${unit}`;
  const said = partial ? `${counted}, ${t("desk.impact.partial")}` : counted;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums" title={`${label}: ${said}`}>
      <Icon name={icon} className={count ? "size-4 text-ink" : "size-4 text-muted"} />
      <span aria-hidden="true" className={count ? "font-semibold" : "text-muted"}>
        {count === null ? "–" : count.toLocaleString("id-ID")}
        {partial ? "+" : ""}
      </span>
      <span className="sr-only">{`${label}: ${said}`}</span>
    </span>
  );
}

export function Victims({
  impact,
  className = "flex flex-wrap",
}: {
  readonly impact: Item["impact"];
  readonly className?: string;
}) {
  const t = useText();
  return (
    <span className={cn("items-center gap-x-3 gap-y-1", className)}>
      {IMPACT.map(([field, icon]) => (
        <Figure
          key={field}
          icon={icon}
          label={t(`desk.impact.${field}`)}
          count={impact[field]}
          unit={t("unit.people")}
        />
      ))}
    </span>
  );
}

export function Houses({ impact }: { readonly impact: Item["impact"] }) {
  const t = useText();
  return (
    <Figure
      icon="house"
      label={t("desk.impact.houses")}
      count={impact.houses?.count ?? null}
      unit={t("unit.houses")}
      partial={impact.houses?.partial ?? false}
    />
  );
}
