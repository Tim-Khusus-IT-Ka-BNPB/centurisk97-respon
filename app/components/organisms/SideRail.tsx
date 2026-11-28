import { Link, useLocation } from "react-router";
import { cn } from "../../lib/cn";
import { isCurrent } from "../../lib/nav";
import { useText } from "../../lib/text";
import { Icon } from "../atoms/Icon";
import type { IconName } from "../atoms/icons";

const ITEMS: readonly { readonly to: string; readonly icon: IconName; readonly label: string }[] = [
  { to: "/", icon: "house", label: "nav.home" },
  { to: "/feed", icon: "map", label: "nav.feed" },
  { to: "/info", icon: "sun", label: "nav.info" },
  { to: "/numbers", icon: "phone", label: "nav.numbers" },
  { to: "/help", icon: "circleHelp", label: "help.title" },
  { to: "/about", icon: "info", label: "nav.about" },
];

// Upstream's side menu on a wide screen: a column of icons that opens over the page while the
// pointer is on its items or the keyboard is in it, so the page never moves. A pointer resting in
// the empty column above or below them leaves it shut. Narrower, the tab bar holds them.
export function SideRail() {
  const t = useText();
  const { pathname } = useLocation();
  return (
    <nav
      aria-label={t("nav.menu")}
      className="group/rail fixed inset-y-0 start-0 z-30 hidden w-[4.75rem] overflow-hidden border-e border-line bg-header px-3 pt-24 transition-[width,box-shadow] duration-150 focus-within:w-60 focus-within:shadow-xl has-[ul:hover]:w-60 has-[ul:hover]:shadow-xl motion-reduce:transition-none lg:block"
    >
      <ul className="flex flex-col gap-1">
        {ITEMS.map(({ to, icon, label }) => {
          const here = isCurrent(pathname, to);
          return (
            <li key={to}>
              <Link
                to={to}
                title={t(label)}
                aria-current={here ? "page" : undefined}
                className={cn(
                  "flex min-h-12 items-center gap-4 rounded-control px-3 font-semibold whitespace-nowrap no-underline",
                  here ? "bg-selected text-primary" : "text-ink hover:bg-sunken",
                )}
              >
                <Icon name={icon} className="size-6" />
                <span className="opacity-0 transition-opacity duration-150 group-focus-within/rail:opacity-100 group-has-[ul:hover]/rail:opacity-100 motion-reduce:transition-none">
                  {t(label)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
