import { Link } from "react-router";
import { useText } from "../../lib/text";
import { buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { EmergencyPanel } from "./EmergencyPanel";

// The opening band: what the service is for, the ways in, and the numbers to call when a life is at
// risk. Who has sent a report is led to it; anyone else to how reporting goes.
export function HomeHero({ sent }: { readonly sent: boolean }) {
  const t = useText();
  return (
    <section aria-labelledby="home-heading" className="contours text-on-hero">
      <div className="mx-auto grid max-w-[72rem] grid-cols-[minmax(0,1fr)] gap-9 px-4 py-10 md:px-6 md:py-16 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-center lg:gap-20 lg:py-24">
        <div className="flex flex-col gap-5">
          <h1 id="home-heading" className="max-w-[19ch] text-display font-extrabold tracking-[-0.02em] text-balance">
            {t("home.hero.title")}
          </h1>
          <p className="max-w-[52ch] text-card text-on-hero-muted text-pretty">{t("home.lead")}</p>
          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Link
              to="/lapor/report?darurat=1"
              className={buttonStyles({ variant: "signal", size: "main", className: "px-7" })}
            >
              <Icon name="triangleAlert" className="size-5" />
              {t("home.emergency")}
            </Link>
            <Link to="/lapor/report" className={buttonStyles({ variant: "accent", size: "main", className: "px-7" })}>
              {t("home.report")}
            </Link>
            <Link
              to="/lapor/orang-hilang"
              className="inline-flex min-h-target items-center justify-center gap-1.5 rounded-control px-3 font-semibold text-on-hero underline decoration-on-hero-muted/50 underline-offset-4 hover:decoration-on-hero"
            >
              <Icon name="userSearch" className="size-5" />
              {t("home.missing")}
            </Link>
            <a
              href={sent ? "#laporan-saya" : "#steps"}
              className="inline-flex min-h-target items-center justify-center gap-1.5 rounded-control px-3 font-semibold text-on-hero underline decoration-on-hero-muted/50 underline-offset-4 hover:decoration-on-hero"
            >
              {t(sent ? "home.reports.check" : "home.hero.howTo")}
            </a>
          </div>
        </div>
        <EmergencyPanel />
      </div>
    </section>
  );
}
