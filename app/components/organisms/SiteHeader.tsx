import { Link, useLocation } from "react-router";
import { cn } from "../../lib/cn";
import { useText } from "../../lib/text";
import { Icon } from "../atoms/Icon";
import { BrandLockup } from "../molecules/BrandLockup";
import { ThemeSwitch } from "../molecules/ThemeSwitch";

const navLink =
  "inline-flex min-h-target-min items-center whitespace-nowrap rounded-control px-3 text-body font-medium text-ink hover:bg-sunken";

function NavLinks({ className }: { readonly className: string }) {
  const t = useText();
  return (
    <nav className={className}>
      <Link to="/lapor/feed" className={navLink}>
        {t("nav.feed")}
      </Link>
      <Link to="/lapor/info" className={navLink}>
        {t("nav.info")}
      </Link>
      <Link to="/lapor/help" className={navLink}>
        {t("help.title")}
      </Link>
      <Link to="/lapor/about" className={navLink}>
        {t("nav.about")}
      </Link>
    </nav>
  );
}

// The band on every page: the way home, and on public pages help and about. On a phone it stays
// one row: the links move into a menu that opens with no script, and closes on each new page.
export function SiteHeader({ nav, width }: { readonly nav: boolean; readonly width: string }) {
  const t = useText();
  const { pathname } = useLocation();
  return (
    <header className="relative border-b border-line bg-header">
      <div
        className={cn(
          "mx-auto flex min-h-16 items-center justify-between gap-3 px-4 py-2 sm:min-h-[4.5rem] sm:gap-6 md:px-6",
          width,
        )}
      >
        <Link to="/lapor" className="-mx-1 inline-flex min-h-target-min min-w-0 items-center rounded-control px-1">
          <BrandLockup />
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          {nav ? <NavLinks className="hidden md:flex" /> : null}
          {/* On a phone a page with links keeps the switch in its menu, so the bar stays one row. */}
          <ThemeSwitch className={nav ? "hidden md:block" : undefined} />
          {nav ? (
            <details key={pathname} className="group md:hidden">
              <summary className="flex size-target-min cursor-pointer list-none items-center justify-center rounded-control text-ink hover:bg-sunken [&::-webkit-details-marker]:hidden">
                <Icon name="menu" />
                <span className="sr-only">{t("nav.menu")}</span>
              </summary>
              <div className="absolute inset-x-0 top-full z-40 flex flex-col gap-1 border-b border-line bg-header px-4 py-2">
                <NavLinks className="flex flex-col gap-1" />
                <ThemeSwitch withLabel className="border-t border-line pt-1" />
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </header>
  );
}
