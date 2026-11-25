import type { ReactNode } from "react";
import { Form, Link, useLocation } from "react-router";
import type { DeskSummary } from "../../../../src/contract/desk";
import { cn } from "../../../lib/cn";
import { DESK_VIEWS, type DeskFilters, type DeskView } from "../../../lib/deskTypes";
import { type Text, useText } from "../../../lib/text";
import { Emblem } from "../../atoms/Emblem";
import { Icon } from "../../atoms/Icon";
import type { IconName } from "../../atoms/icons";
import { ThemeSwitch } from "../../molecules/ThemeSwitch";
import { deskLink, STATUSES, StatusDot } from "./parts";

const VIEW_ICON: Readonly<Record<DeskView, IconName>> = { list: "list", map: "map", gallery: "images" };

const item =
  "flex min-h-target-min items-center gap-3 rounded-control px-2.5 text-ink no-underline hover:bg-sunken aria-[current=page]:bg-selected aria-[current=page]:font-semibold";

function Count({ n }: { readonly n: number | undefined }) {
  return n === undefined ? null : (
    <span className="ms-auto text-meta text-muted tabular-nums">{n.toLocaleString("id-ID")}</span>
  );
}

// A link's name with its count, as a screen reader should say it: "Ditelaah, 2 laporan".
export const counted = (t: Text, label: string, n: number | undefined) =>
  n === undefined ? undefined : `${label}, ${n.toLocaleString("id-ID")} ${t("desk.reports")}`;

function Group({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      <p className="px-2.5 pb-1 text-meta font-semibold text-muted">{label}</p>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </nav>
  );
}

// What the side menu points at: the view and status queue in use, and the counts beside them.
export type DeskPlace = {
  readonly filters: DeskFilters;
  // Null on a report page: no view or queue is the current one there.
  readonly current: { readonly view: DeskView; readonly status: string } | null;
  readonly summary: DeskSummary | null;
};

function DeskNav({ place, account }: { readonly place: DeskPlace; readonly account: string }) {
  const t = useText();
  const { filters, current, summary } = place;
  const all = summary === null ? undefined : STATUSES.reduce((sum, status) => sum + summary.byStatus[status], 0);
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2 rounded-control border border-line p-2.5">
        <p className="text-meta text-muted">{t("desk.account", { label: account })}</p>
        <div className="flex items-center justify-between gap-2">
          <ThemeSwitch />
          <Form method="post" action="/lapor/meja">
            <input type="hidden" name="action" value="signOut" />
            <button type="submit" className={cn(item, "font-medium")}>
              <Icon name="logOut" />
              {t("desk.signOut")}
            </button>
          </Form>
        </div>
      </div>
      <Group label={t("desk.nav.views")}>
        {DESK_VIEWS.map((view) => (
          <li key={view}>
            <Link
              to={deskLink(filters, { view, page: 1 })}
              aria-current={current?.view === view ? "page" : undefined}
              className={item}
            >
              <Icon name={VIEW_ICON[view]} />
              {t(`desk.nav.view.${view}`)}
            </Link>
          </li>
        ))}
      </Group>
      <Group label={t("desk.nav.queues")}>
        <li>
          <Link
            to={deskLink(filters, { status: "", page: 1 })}
            aria-current={current !== null && current.status === "" ? "page" : undefined}
            aria-label={counted(t, t("desk.nav.all"), all)}
            className={item}
          >
            <Icon name="inbox" />
            {t("desk.nav.all")}
            <Count n={all} />
          </Link>
        </li>
        {STATUSES.map((status) => (
          <li key={status}>
            <Link
              to={deskLink(filters, { status, page: 1 })}
              aria-current={current?.status === status ? "page" : undefined}
              aria-label={counted(t, t(`stage.short.${status}`), summary?.byStatus[status])}
              className={item}
            >
              <span className="flex size-5 items-center justify-center">
                <StatusDot status={status} />
              </span>
              {t(`stage.short.${status}`)}
              <Count n={summary?.byStatus[status]} />
            </Link>
          </li>
        ))}
      </Group>
      <Group label={t("desk.nav.doors")}>
        <li>
          <Link to="/lapor" className={item}>
            <Icon name="send" />
            {t("desk.nav.reportForm")}
          </Link>
        </li>
      </Group>
    </div>
  );
}

function Brand() {
  const t = useText();
  return (
    <Link
      to="/lapor/meja"
      aria-label={`${t("desk.title")}, ${t("app.name")}`}
      className="flex min-h-target-min items-center gap-3 rounded-control px-1 no-underline"
    >
      <Emblem size={32} />
      <span className="flex flex-col leading-tight">
        <span className="font-bold text-ink">{t("desk.title")}</span>
        <span className="text-meta text-muted">{t("app.name")}</span>
      </span>
    </Link>
  );
}

// The desk's frame: a side menu beside the work on a wide screen; on a phone a bar with the brand,
// the theme and a menu that opens with no script.
export function DeskShell({
  place,
  account,
  children,
}: {
  readonly place: DeskPlace;
  readonly account: string;
  readonly children: ReactNode;
}) {
  const t = useText();
  const { pathname, search } = useLocation();
  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="hidden border-e border-line bg-header lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:gap-6 lg:overflow-y-auto lg:px-3 lg:py-4">
        <Brand />
        <DeskNav place={place} account={account} />
      </aside>
      <header className="sticky top-0 z-30 border-b border-line bg-header lg:hidden">
        <div className="flex min-h-14 items-center justify-between gap-2 px-3">
          <Brand />
          <div className="flex items-center gap-1">
            <ThemeSwitch />
            <details key={`${pathname}${search}`} className="group">
              <summary className="flex min-h-target-min cursor-pointer list-none items-center gap-2 rounded-control px-2.5 font-medium text-ink hover:bg-sunken [&::-webkit-details-marker]:hidden">
                <Icon name="menu" />
                {t("desk.nav.menu")}
              </summary>
              <div className="absolute inset-x-0 top-full flex max-h-[80dvh] flex-col overflow-y-auto border-b border-line bg-header px-3 py-4 shadow-[0_8px_24px_var(--dock-shadow)]">
                <DeskNav place={place} account={account} />
              </div>
            </details>
          </div>
        </div>
      </header>
      <main className="flex min-w-0 flex-col gap-5 px-4 py-5 md:px-6 lg:px-8 lg:py-7">{children}</main>
    </div>
  );
}
