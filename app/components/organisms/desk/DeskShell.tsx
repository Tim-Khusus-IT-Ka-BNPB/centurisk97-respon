import type { ReactNode } from "react";
import { Form, Link, useLocation } from "react-router";
import type { DeskSummary } from "../../../../src/contract/desk";
import type { Text } from "../../../../src/copy/text";
import { cn } from "../../../lib/cn";
import { DESK_VIEWS, type DeskFilters, type DeskView } from "../../../lib/deskTypes";
import { useText } from "../../../lib/text";
import { Emblem } from "../../atoms/Emblem";
import { Icon } from "../../atoms/Icon";
import type { IconName } from "../../atoms/icons";
import { ThemeSwitch } from "../../molecules/ThemeSwitch";
import { EmergencyBanner } from "./EmergencyBanner";
import { deskLink, STATUSES, StatusDot } from "./parts";

const NONE: DeskSummary["emergencies"] = [];
const RESPONSE = "/desk/response";
const MISSING = "/desk/missing";

const VIEW_ICON: Readonly<Record<DeskView, IconName>> = { list: "list", map: "map", gallery: "images" };

const item =
  "group/item flex min-h-target-min items-center gap-3 rounded-control px-3 text-ink no-underline transition-colors duration-100 motion-reduce:transition-none hover:bg-sunken pointer-fine:min-h-10 lg:text-[0.9375rem] aria-[current=page]:bg-selected aria-[current=page]:font-semibold aria-[current=page]:text-primary";

const navIcon = "text-muted group-aria-[current=page]/item:text-primary";

function Count({ n }: { readonly n: number | undefined }) {
  return n === undefined ? null : (
    <span
      className={cn(
        "ms-auto text-meta tabular-nums group-aria-[current=page]/item:text-primary",
        n === 0 ? "text-muted" : "font-semibold",
      )}
    >
      {n.toLocaleString("id-ID")}
    </span>
  );
}

// A link's name with its count, as a screen reader should say it: "Ditelaah, 2 laporan".
export const counted = (t: Text, label: string, n: number | undefined) =>
  n === undefined ? undefined : `${label}, ${n.toLocaleString("id-ID")} ${t("desk.reports")}`;

function Group({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      <p className="px-3 pb-1 text-meta text-muted">{label}</p>
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

// Who is signed in, the theme and the way out.
function Account({ account, className }: { readonly account: string; readonly className?: string }) {
  const t = useText();
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <p className="flex items-center gap-3 px-3 py-1 text-meta">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-on-primary uppercase"
        >
          {account.slice(0, 1)}
        </span>
        <span className="min-w-0 text-muted">{t("desk.account", { label: account })}</span>
      </p>
      <div className="flex items-center justify-between gap-2">
        <Form method="post" action="/desk" className="flex-1">
          <input type="hidden" name="action" value="signOut" />
          <button type="submit" className={cn(item, "w-full")}>
            <Icon name="logOut" className="text-muted" />
            {t("desk.signOut")}
          </button>
        </Form>
        <ThemeSwitch />
      </div>
    </div>
  );
}

function DeskNav({ place }: { readonly place: DeskPlace }) {
  const t = useText();
  const { pathname } = useLocation();
  const { filters, current, summary } = place;
  const all = summary === null ? undefined : STATUSES.reduce((sum, status) => sum + summary.byStatus[status], 0);
  return (
    <div className="flex flex-col gap-5">
      <Group label={t("desk.nav.views")}>
        {DESK_VIEWS.map((view) => (
          <li key={view}>
            <Link
              to={deskLink(filters, { view, page: 1 })}
              aria-current={current?.view === view ? "page" : undefined}
              className={item}
            >
              <Icon name={VIEW_ICON[view]} className={navIcon} />
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
            <Icon name="inbox" className={navIcon} />
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
              <span className="flex size-5 shrink-0 items-center justify-center">
                <StatusDot status={status} />
              </span>
              {t(`stage.short.${status}`)}
              <Count n={summary?.byStatus[status]} />
            </Link>
          </li>
        ))}
      </Group>
      <Group label={t("desk.nav.doors")}>
        {summary?.mayReadResponse ? (
          <li>
            <Link to={RESPONSE} aria-current={pathname === RESPONSE ? "page" : undefined} className={item}>
              <Icon name="clock" className={navIcon} />
              {t("desk.response.title")}
            </Link>
          </li>
        ) : null}
        {/* The WhatsApp pilot numbers (/desk/pilot) are left out of the menu while WhatsApp waits
            (owner, 26 Nov 2026); the page itself still opens. */}
        <li>
          <Link to={MISSING} aria-current={pathname === MISSING ? "page" : undefined} className={item}>
            <Icon name="userSearch" className={navIcon} />
            {t("missing.desk.title")}
          </Link>
        </li>
        <li>
          <Link to="/poster" className={item}>
            <Icon name="scan" className={navIcon} />
            {t("desk.nav.poster")}
          </Link>
        </li>
        <li>
          <Link to="/" className={item}>
            <Icon name="send" className={navIcon} />
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
      to="/desk"
      aria-label={`${t("desk.title")}, ${t("app.name")}`}
      className="flex min-h-target-min w-fit items-center gap-3 rounded-control px-1 no-underline"
    >
      <Emblem size={32} />
      <span className="flex flex-col leading-tight">
        <span className="font-bold whitespace-nowrap text-ink">{t("desk.title")}</span>
        <span className="text-meta whitespace-nowrap text-muted max-[359px]:hidden">{t("app.name")}</span>
      </span>
    </Link>
  );
}

// The desk's frame: a side menu beside the work on a wide screen; on a phone a bar with the brand,
// the theme and a menu that opens with no script.
export function DeskShell({
  place,
  account,
  fill = false,
  children,
}: {
  readonly place: DeskPlace;
  readonly account: string;
  // The work takes the whole window beside the menu, edge to edge, as the map does.
  readonly fill?: boolean;
  readonly children: ReactNode;
}) {
  const t = useText();
  const { pathname, search } = useLocation();
  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      <aside className="hidden border-e border-line bg-header lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="px-4 py-3">
          <Brand />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <DeskNav place={place} />
        </div>
        <Account account={account} className="border-t border-line p-3" />
      </aside>
      <header className="sticky top-0 z-30 border-b border-line bg-header lg:hidden">
        <div className="flex min-h-14 items-center justify-between gap-2 px-3">
          <Brand />
          <div className="flex items-center gap-1">
            <details key={`${pathname}${search}`} className="group">
              <summary className="flex min-h-target-min cursor-pointer list-none items-center gap-2 rounded-control px-2.5 font-medium text-ink hover:bg-sunken [&::-webkit-details-marker]:hidden">
                <Icon name="menu" />
                <span className="max-[359px]:sr-only">{t("desk.nav.menu")}</span>
              </summary>
              <div className="absolute inset-x-0 top-full flex max-h-[85dvh] flex-col gap-4 overflow-y-auto border-b border-line bg-header px-3 py-4 shadow-float">
                <DeskNav place={place} />
                <Account account={account} className="border-t border-line pt-3" />
              </div>
            </details>
          </div>
        </div>
      </header>
      <div className={cn("flex min-w-0 flex-col", fill ? "lg:h-dvh lg:overflow-hidden" : "")}>
        <EmergencyBanner initial={place.summary?.emergencies ?? NONE} />
        <main
          className={cn(
            "flex min-w-0 flex-1 flex-col",
            fill ? "lg:min-h-0" : "gap-5 px-4 py-5 md:px-6 lg:px-8 lg:py-7",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
