import type { ReactNode } from "react";
import { Form, Link } from "react-router";
import type { DeskSummary } from "../../../../src/contract/desk";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { DESK_HAS, DESK_PERIODS, type DeskHas } from "../../../../src/domain/deskQueue";
import { HAZARD_TYPE_IDS, SELECTABLE_HAZARD_TYPES } from "../../../../src/domain/hazards";
import { cn } from "../../../lib/cn";
import { DESK_VIEWS, type DeskFilters } from "../../../lib/deskTypes";
import { problemOf } from "../../../lib/envelope";
import { hazardIcon } from "../../../lib/hazardIcons";
import { useFocusOnChange } from "../../../lib/hooks";
import { useText } from "../../../lib/text";
import { buttonStyles } from "../../atoms/Button";
import { Input } from "../../atoms/controls";
import { Icon } from "../../atoms/Icon";
import type { IconName } from "../../atoms/icons";
import { FieldError } from "../../molecules/Field";
import { counted } from "./DeskShell";
import { clearedLink, deskLink, hazardLabel, isFiltered } from "./parts";

const chip =
  "inline-flex min-h-target-min shrink-0 items-center gap-2 rounded-control border border-line bg-surface px-3 text-ink no-underline hover:border-control lg:min-h-10 lg:text-[0.9375rem] aria-[current=true]:border-primary aria-[current=true]:bg-selected aria-[current=true]:font-semibold aria-[current=true]:text-primary";

const switcher = "inline-flex w-fit max-w-full flex-wrap rounded-control bg-sunken p-1";

const segment =
  "inline-flex min-h-10 items-center justify-center rounded-[6px] px-3 whitespace-nowrap text-muted no-underline hover:text-ink lg:min-h-8 lg:text-[0.9375rem] max-[359px]:px-2 max-[359px]:text-meta aria-[current=true]:bg-thumb aria-[current=true]:font-semibold aria-[current=true]:text-ink aria-[current=true]:shadow-card";

function Tally({ n }: { readonly n: number | undefined }) {
  return n === undefined ? null : (
    <span className="text-meta text-muted tabular-nums">{n.toLocaleString("id-ID")}</span>
  );
}

type Counted = { readonly filters: DeskFilters; readonly summary: DeskSummary | null };

// The hazard types as links with their counts, in one row that scrolls.
export function HazardChips({ filters, summary, className }: Counted & { readonly className?: string }) {
  const t = useText();
  const byHazard = summary?.byHazard;
  // With counts: the types that have reports, and the one picked. Without: every type offered.
  const hazards =
    byHazard === undefined
      ? SELECTABLE_HAZARD_TYPES
      : HAZARD_TYPE_IDS.filter((id) => (byHazard[id] ?? 0) > 0 || filters.hazardType === id);
  const all =
    byHazard === undefined ? undefined : Object.values(byHazard).reduce((sum: number, n) => sum + (n as number), 0);
  const countOf = (id: (typeof hazards)[number]) => (byHazard === undefined ? undefined : (byHazard[id] ?? 0));
  return (
    <nav aria-label={t("desk.filter.hazard")} className={cn("flex min-w-0 gap-2", className)}>
      <Link
        to={deskLink(filters, { hazardType: "", page: 1 })}
        aria-current={filters.hazardType === "" ? "true" : undefined}
        aria-label={counted(t, t("desk.filter.allHazards"), all)}
        className={chip}
      >
        {t("desk.filter.allHazards")}
        <Tally n={all} />
      </Link>
      {hazards.map((id) => (
        <Link
          key={id}
          to={deskLink(filters, { hazardType: filters.hazardType === id ? "" : id, page: 1 })}
          aria-current={filters.hazardType === id ? "true" : undefined}
          aria-label={counted(t, hazardLabel(t, id), countOf(id))}
          className={chip}
        >
          <Icon name={hazardIcon(id)} className="size-4" />
          {hazardLabel(t, id)}
          <Tally n={countOf(id)} />
        </Link>
      ))}
    </nav>
  );
}

export function PeriodSegment({ filters, className }: Pick<Counted, "filters"> & { readonly className?: string }) {
  const t = useText();
  return (
    <nav aria-label={t("desk.filter.period")} className={cn(switcher, className)}>
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
  );
}

const HAS_ICON: Readonly<Record<DeskHas, IconName>> = {
  victims: "heartCrack",
  displaced: "tent",
  houses: "house",
  photos: "camera",
};

function HasLink({
  has,
  filters,
  summary,
  className,
  children,
}: Counted & { readonly has: DeskHas; readonly className: string; readonly children: ReactNode }) {
  const t = useText();
  return (
    <Link
      to={deskLink(filters, { has: filters.has === has ? "" : has, page: 1 })}
      aria-current={filters.has === has ? "true" : undefined}
      aria-label={counted(t, t(`desk.has.${has}`), summary?.byHas[has])}
      className={className}
    >
      {children}
    </Link>
  );
}

// What the reports hold, as chips in the filter bar.
function HasChips({ filters, summary }: Counted) {
  const t = useText();
  return (
    <nav aria-label={t("desk.filter.has")} className="flex shrink-0 gap-2">
      {DESK_HAS.map((has) => (
        <HasLink key={has} has={has} filters={filters} summary={summary} className={chip}>
          <Icon name={HAS_ICON[has]} className="size-4" />
          {t(`desk.has.${has}`)}
          <Tally n={summary?.byHas[has]} />
        </HasLink>
      ))}
    </nav>
  );
}

// The same beside the map: its figures, each one a filter.
export function HasTiles({ filters, summary }: Counted) {
  const t = useText();
  return (
    <nav aria-label={t("desk.filter.has")} className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-2">
      {DESK_HAS.map((has) => (
        <HasLink
          key={has}
          has={has}
          filters={filters}
          summary={summary}
          className="flex min-h-target items-center gap-2.5 rounded-control border border-line bg-surface px-2.5 py-1.5 text-ink no-underline hover:bg-sunken aria-[current=true]:border-primary aria-[current=true]:bg-selected"
        >
          <Icon name={HAS_ICON[has]} className="size-5 text-muted" />
          <span className="flex min-w-0 flex-col leading-tight">
            {summary === null ? null : (
              <span className={cn("text-card font-bold tabular-nums", summary.byHas[has] === 0 ? "text-muted" : "")}>
                {summary.byHas[has].toLocaleString("id-ID")}
              </span>
            )}
            <span className="text-meta text-muted">{t(`desk.has.${has}`)}</span>
          </span>
        </HasLink>
      ))}
    </nav>
  );
}

export function TicketSearch({
  filters,
  envelope,
  className,
}: {
  readonly filters: DeskFilters;
  readonly envelope: ErrorEnvelope | null;
  readonly className?: string;
}) {
  const t = useText();
  const problem = problemOf(envelope, "ticket");
  useFocusOnChange(problem === null ? null : "ticket", envelope);
  return (
    <Form method="get" role="search" className={cn("flex flex-col gap-1", className)}>
      {(["view", "status", "hazardType", "period", "has"] as const).map((name) =>
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
          className="min-w-0 flex-1 lg:min-h-10 lg:py-1.5"
        />
        <button type="submit" className={buttonStyles({ variant: "secondary", className: "lg:min-h-10 lg:py-1.5" })}>
          <Icon name="search" className="size-4" />
          {t("desk.filter.search")}
        </button>
      </div>
      <FieldError id="ticket" problem={problem} />
    </Form>
  );
}

// Back to everything in this view; shown only while something is filtered.
export function ClearFilters({ filters, className }: Pick<Counted, "filters"> & { readonly className?: string }) {
  const t = useText();
  return isFiltered(filters) ? (
    <Link to={clearedLink(filters)} className={cn(buttonStyles({ variant: "link", size: "min" }), className)}>
      {t("desk.filter.clear")}
    </Link>
  ) : null;
}

// Every filter above the list and the gallery: the search and the period, then one row of chips.
export function FilterBar({ filters, summary, envelope }: Counted & { readonly envelope: ErrorEnvelope | null }) {
  const t = useText();
  return (
    <section aria-label={t("desk.filters")} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <TicketSearch filters={filters} envelope={envelope} className="md:w-80" />
        <span className="flex flex-wrap items-center gap-2 md:flex-row-reverse">
          <PeriodSegment filters={filters} />
          <ClearFilters filters={filters} />
        </span>
      </div>
      <div className="fade-x -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
        <HazardChips filters={filters} summary={summary} className="shrink-0" />
        <span aria-hidden="true" className="mx-1 my-2 w-px shrink-0 bg-line" />
        <HasChips filters={filters} summary={summary} />
      </div>
    </section>
  );
}

// On a phone the views sit above the work; on a wide screen the side menu holds them.
export function ViewTabs({ filters }: { readonly filters: DeskFilters }) {
  const t = useText();
  return (
    <nav aria-label={t("desk.views")} className={cn(switcher, "lg:hidden")}>
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
