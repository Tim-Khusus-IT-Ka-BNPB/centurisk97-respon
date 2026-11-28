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
];

// Below 1024px the public pages' main places sit in a bar at the bottom, where a thumb reaches; wider,
// the side rail holds them. Each tab has room for a label on two lines, so the bar keeps one height
// and the page's bottom space (Page) matches it. It steps aside while a field is being typed in, so the keyboard does not
// push it over the field.
export function TabBar() {
  const t = useText();
  const { pathname } = useLocation();
  return (
    <nav
      aria-label={t("nav.main")}
      className="hide-while-typing fixed inset-x-0 bottom-0 z-30 border-t border-line bg-header pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto grid max-w-[40rem] grid-cols-5">
        {ITEMS.map(({ to, icon, label }) => {
          const here = isCurrent(pathname, to);
          return (
            <li key={to} className="min-w-0">
              <Link
                to={to}
                aria-current={here ? "page" : undefined}
                className={cn(
                  "flex h-18 flex-col items-center justify-start gap-0.5 px-1 pt-2.5 text-center text-[0.75rem] leading-tight no-underline",
                  here ? "font-bold text-primary" : "font-medium text-muted hover:text-ink",
                )}
              >
                <Icon name={icon} className="size-6 shrink-0" />
                {/* Two lines of room, the label centred in it, so a one-line label sits level with
                    the middle of a wrapped one. */}
                <span className="flex h-[1.875rem] max-w-full items-center">
                  <span className="text-balance">{t(label)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
