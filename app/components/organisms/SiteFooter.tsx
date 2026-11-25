import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { useText } from "../../lib/text";
import { BrandLockup } from "../molecules/BrandLockup";

const link = "inline-flex min-h-target-min items-center underline-offset-4 hover:underline";

export function SiteFooter({ width }: { readonly width: string }) {
  const t = useText();
  return (
    <footer className="bg-hero text-on-hero-muted [--focus:var(--on-hero)]">
      <div
        className={cn(
          "mx-auto flex flex-col gap-4 px-4 py-8 md:flex-row md:items-center md:justify-between md:px-6",
          width,
        )}
      >
        <BrandLockup tone="hero" />
        <nav className="flex flex-wrap gap-x-5 text-meta">
          <Link to="/lapor/help" className={link}>
            {t("help.title")}
          </Link>
          <Link to="/lapor/about" className={link}>
            {t("nav.about")}
          </Link>
          <Link to="/lapor/privacy" className={link}>
            {t("nav.privacy")}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
