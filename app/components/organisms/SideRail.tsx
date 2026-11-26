import { Link, useLocation } from "react-router";
import { cn } from "../../lib/cn";
import { useText } from "../../lib/text";
import { Icon } from "../atoms/Icon";
import type { IconName } from "../atoms/icons";

const ITEMS: readonly { readonly to: string; readonly icon: IconName; readonly label: string }[] = [
  { to: "/lapor", icon: "house", label: "nav.home" },
  { to: "/lapor/feed", icon: "map", label: "nav.feed" },
  { to: "/lapor/info", icon: "sun", label: "nav.info" },
  { to: "/lapor/nomor-penting", icon: "phone", label: "nav.numbers" },
  { to: "/lapor/help", icon: "circleHelp", label: "help.title" },
  { to: "/lapor/about", icon: "info", label: "nav.about" },
];

// Upstream's side menu on a wide screen: a column of icons that opens over the page while the
// pointer or the keyboard is on it, so the page never moves. A phone keeps the header's menu.
export function SideRail() {
  const t = useText();
  const { pathname } = useLocation();
  return (
    <nav
      aria-label={t("nav.menu")}
      className="group/rail fixed inset-y-0 start-0 z-30 hidden w-[4.75rem] flex-col gap-1 overflow-hidden border-e border-line bg-header px-3 pt-24 transition-[width,box-shadow] duration-150 hover:w-60 hover:shadow-xl focus-within:w-60 focus-within:shadow-xl motion-reduce:transition-none lg:flex"
    >
      {ITEMS.map(({ to, icon, label }) => {
        const here = to === "/lapor" ? pathname === to || pathname === "/lapor/" : pathname.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            title={t(label)}
            aria-current={here ? "page" : undefined}
            className={cn(
              "flex min-h-12 items-center gap-4 rounded-control px-3 font-semibold whitespace-nowrap no-underline",
              here ? "bg-selected text-primary" : "text-ink hover:bg-sunken",
            )}
          >
            <Icon name={icon} className="size-6" />
            <span className="opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100 group-focus-within/rail:opacity-100 motion-reduce:transition-none">
              {t(label)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
