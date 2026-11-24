import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { useText } from "../../lib/text";
import { BrandLockup } from "../molecules/BrandLockup";

const navLink =
  "inline-flex min-h-target-min items-center rounded-control px-3 text-body font-medium text-ink hover:bg-sunken";

// The band on every page: the way home, and on public pages help and about.
export function SiteHeader({ nav, width }: { readonly nav: boolean; readonly width: string }) {
  const t = useText();
  return (
    <header className="border-b border-line bg-header">
      <div
        className={cn(
          "mx-auto flex min-h-[4.5rem] flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-2 md:px-6",
          width,
        )}
      >
        <Link to="/lapor" className="-mx-1 inline-flex min-h-target-min items-center rounded-control px-1">
          <BrandLockup />
        </Link>
        {nav ? (
          <nav className="-mx-3 flex flex-wrap">
            <Link to="/lapor/help" className={navLink}>
              {t("help.title")}
            </Link>
            <Link to="/lapor/about" className={navLink}>
              {t("nav.about")}
            </Link>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
