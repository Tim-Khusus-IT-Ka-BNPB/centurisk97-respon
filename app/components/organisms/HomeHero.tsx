import { Link } from "react-router";
import { useText } from "../../lib/text";
import { buttonStyles } from "../atoms/Button";
import { EmergencyPanel } from "./EmergencyPanel";

// The opening band: what the service is for, the one way in, and the number to call when a life is at risk.
export function HomeHero() {
  const t = useText();
  return (
    <section aria-labelledby="home-heading" className="contours text-on-hero">
      <div className="relative mx-auto grid max-w-[72rem] gap-8 px-4 py-12 md:px-6 md:py-16 lg:grid-cols-[1fr_22rem] lg:items-center lg:gap-16 lg:py-20">
        <div className="flex flex-col gap-5">
          <p className="text-meta font-semibold text-accent">{t("home.hero.kicker")}</p>
          <h1 id="home-heading" className="max-w-[18ch] text-display font-extrabold tracking-[-0.025em] text-balance">
            {t("home.hero.title")}
          </h1>
          <p className="max-w-[56ch] text-card text-on-hero-muted">{t("home.lead")}</p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              to="/lapor/report"
              className={buttonStyles({ variant: "accent", size: "main", className: "w-full px-8 sm:w-auto" })}
            >
              {t("home.report")}
            </Link>
            <a
              href="#steps"
              className={buttonStyles({ variant: "onHero", size: "main", className: "w-full sm:w-auto" })}
            >
              {t("home.hero.howTo")}
            </a>
          </div>
        </div>
        <EmergencyPanel />
      </div>
    </section>
  );
}
