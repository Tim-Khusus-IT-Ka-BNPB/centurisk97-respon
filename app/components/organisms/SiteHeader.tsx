import { Link, useLocation } from "react-router";
import { cn } from "../../lib/cn";
import { useText } from "../../lib/text";
import { Icon } from "../atoms/Icon";
import { BrandLockup } from "../molecules/BrandLockup";
import { LanguageLink, LanguagePicker } from "../molecules/LanguagePicker";
import { ThemeSwitch } from "../molecules/ThemeSwitch";

const navLink =
  "inline-flex min-h-target-min items-center whitespace-nowrap rounded-control px-3 text-body font-medium text-ink hover:bg-sunken";

const quickIcon =
  "hidden size-target-min items-center justify-center rounded-control text-ink hover:bg-sunken sm:inline-flex";

// Upstream's two marks beside the theme switch: the early warnings, and the numbers to call.
function QuickIcons() {
  const t = useText();
  return (
    <>
      <Link to="/info#info-warn" aria-label={t("nav.warnings")} title={t("nav.warnings")} className={quickIcon}>
        <Icon name="bell" />
      </Link>
      <Link to="/numbers" aria-label={t("nav.numbers")} title={t("nav.numbers")} className={quickIcon}>
        <Icon name="phone" />
      </Link>
    </>
  );
}

// The band on every page: the way home, the language and the theme. A wide screen has the public
// links in the side rail; below 1024px the main ones sit in the tab bar and the rest in a menu that
// opens with no script, and closes on each new page.
export function SiteHeader({
  nav,
  width,
  languages = true,
}: {
  readonly nav: boolean;
  readonly width: string;
  // A page shown with no connection offers no language: picking one needs the service.
  readonly languages?: boolean;
}) {
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
        <Link to="/" className="-mx-1 inline-flex min-h-target-min min-w-0 items-center rounded-control px-1">
          <BrandLockup />
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          {/* On a phone a page with links keeps the switch in its menu, so the bar stays one row. */}
          {/* A phone's menu holds the language too, so the bar stays one row at 320px. */}
          {languages ? <LanguagePicker className={nav ? "hidden sm:inline-flex" : undefined} /> : null}
          {nav ? <QuickIcons /> : null}
          <ThemeSwitch className={nav ? "hidden lg:block" : undefined} />
          {nav ? (
            <details key={pathname} className="group lg:hidden">
              <summary className="flex size-target-min cursor-pointer list-none items-center justify-center rounded-control text-ink hover:bg-sunken [&::-webkit-details-marker]:hidden">
                <Icon name="menu" />
                <span className="sr-only">{t("nav.menu")}</span>
              </summary>
              <div className="absolute inset-x-0 top-full z-40 flex flex-col gap-1 border-b border-line bg-header px-4 py-2">
                <Link to="/about" className={navLink}>
                  {t("nav.about")}
                </Link>
                {/* Only the page cut off from the service drops the language, and it has no menu. */}
                <LanguageLink className={cn(navLink, "gap-2 sm:hidden")} />
                <ThemeSwitch withLabel className="border-t border-line pt-1" />
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </header>
  );
}
