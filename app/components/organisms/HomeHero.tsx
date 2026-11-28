import { useState } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { useHydrated } from "../../lib/hooks";
import { useText } from "../../lib/text";
import { Icon } from "../atoms/Icon";
import type { IconName } from "../atoms/icons";
import { SigapAvatar } from "../molecules/SigapAvatar";
import { SigapTour } from "./SigapTour";

// The two ways in, each with what it is for. Their names keep the ids the tour points at.
function Door({
  to,
  door,
  icon,
  look,
}: {
  readonly to: string;
  readonly door: "report" | "emergency";
  readonly icon: IconName;
  readonly look: string;
}) {
  const t = useText();
  return (
    <Link
      to={to}
      aria-labelledby={`door-${door}`}
      aria-describedby={`door-${door}-note`}
      className={cn(
        "group flex min-h-20 items-center gap-4 rounded-[1.125rem] px-5 py-4 no-underline shadow-float transition duration-150 ease-out motion-reduce:transition-none",
        look,
      )}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-black/10">
        <Icon name={icon} className="size-6" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span id={`door-${door}`} className="text-card font-extrabold">
          {t(`home.door.${door}`)}
        </span>
        <span id={`door-${door}-note`} className="text-meta opacity-90">
          {t(`home.door.${door}.note`)}
        </span>
      </span>
      <Icon
        name="chevronRight"
        className="size-6 shrink-0 transition-transform duration-150 group-hover:translate-x-1 motion-reduce:transition-none"
      />
    </Link>
  );
}

// What a report looks like from the inside: words in a regional language, what Sigap noted of them,
// and the next question. An example, and named so.
function SigapDemo() {
  const t = useText();
  const hydrated = useHydrated();
  const [touring, setTouring] = useState(false);
  const noted = [
    t("hazard.flood.label"),
    t("reply.notedChoice", { label: t("field.waterDepth.label"), value: t("option.waterDepth.knee.label") }),
    t("reply.notedCount.housesFlooded", { count: 20 }),
  ];
  return (
    <figure
      aria-labelledby="demo-label"
      className="flex flex-col gap-3 rounded-[1.5rem] bg-surface p-4 text-ink shadow-float [--focus:var(--focus-page)] md:p-5"
    >
      <figcaption className="flex items-center gap-3 border-b border-line pb-3">
        <SigapAvatar className="size-11" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-bold">Sigap</span>
          <span className="text-meta text-muted">{t("home.demo.role")}</span>
        </span>
        <span id="demo-label" className="rounded-full bg-sunken px-2.5 py-1 text-meta font-semibold text-muted">
          {t("home.demo.label")}
        </span>
      </figcaption>
      <ol className="flex flex-col gap-2.5 text-body">
        <li className="max-w-[88%] self-end rounded-[1.125rem] rounded-ee-chip bg-primary px-4 py-2.5 text-on-primary motion-safe:animate-rise">
          <span lang="jv">{t("home.demo.said")}</span>
        </li>
        <li className="flex max-w-[92%] flex-col gap-2 self-start rounded-[1.125rem] rounded-es-chip border border-line bg-surface px-4 py-3 motion-safe:animate-rise motion-safe:[animation-delay:700ms]">
          <span>{t("reply.noted")}</span>
          <span className="flex flex-wrap gap-1.5">
            {noted.map((fact) => (
              <span
                key={fact}
                className="inline-flex items-center gap-1 rounded-full bg-selected px-2.5 py-1 text-meta font-semibold text-primary"
              >
                <Icon name="check" className="size-4" />
                {fact}
              </span>
            ))}
          </span>
        </li>
        <li className="max-w-[92%] self-start rounded-[1.125rem] rounded-es-chip border border-line bg-surface px-4 py-2.5 motion-safe:animate-rise motion-safe:[animation-delay:1400ms]">
          {t("home.demo.next")}
        </li>
      </ol>
      {hydrated ? (
        <button
          type="button"
          onClick={() => setTouring(true)}
          className="inline-flex min-h-target-min items-center gap-1.5 self-start rounded-control font-semibold text-primary underline-offset-4 hover:underline"
        >
          <Icon name="circleHelp" className="size-5" />
          {t("sigap.home.tour")}
        </button>
      ) : null}
      {touring ? <SigapTour onClose={() => setTouring(false)} /> : null}
    </figure>
  );
}

// When a life is at risk a report waits too long: the two numbers, one press each.
function CallNow() {
  const t = useText();
  const call = "inline-flex min-h-target items-center gap-2 rounded-full px-4 font-extrabold tabular-nums no-underline";
  return (
    <section
      aria-labelledby="emergency-heading"
      className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[1.125rem] border border-white/15 bg-white/5 px-4 py-3"
    >
      <p className="min-w-0 flex-1 basis-56">
        <span id="emergency-heading" className="font-bold">
          {t("about.emergency.title")}
        </span>{" "}
        <span className="text-on-hero-muted">{t("about.emergency.body")}</span>
      </p>
      <span className="flex gap-2">
        <a
          href={`tel:${t("about.emergency.112")}`}
          aria-label={`${t("about.emergency.112")} ${t("about.emergency.112Label")}`}
          className={cn(call, "bg-signal text-on-signal hover:bg-signal-deep")}
        >
          <Icon name="phone" className="size-5" />
          {t("about.emergency.112")}
        </a>
        <a
          href={`tel:${t("about.emergency.117")}`}
          aria-label={`${t("about.emergency.117")} ${t("about.emergency.117Label")}`}
          className={cn(call, "bg-white/12 text-on-hero hover:bg-white/20")}
        >
          <Icon name="phone" className="size-5" />
          {t("about.emergency.117")}
        </a>
      </span>
    </section>
  );
}

const quietLink =
  "inline-flex min-h-target items-center gap-1.5 rounded-control px-3 font-semibold text-on-hero underline decoration-on-hero-muted/50 underline-offset-4 hover:decoration-on-hero";

// The opening band asks the one question the site is for, offers the two ways to answer it, shows
// how a report goes, and the numbers to call when a life is at risk.
export function HomeHero({ sent }: { readonly sent: boolean }) {
  const t = useText();
  return (
    <section aria-labelledby="home-heading" className="contours text-on-hero">
      <div className="mx-auto grid max-w-[72rem] grid-cols-[minmax(0,1fr)] gap-10 px-4 py-10 md:px-6 md:py-14 lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-center lg:gap-16 lg:py-20">
        <div className="flex flex-col gap-6">
          <h1 id="home-heading" className="max-w-[15ch] text-display font-extrabold tracking-[-0.025em] text-balance">
            {t("home.hero.ask")}
          </h1>
          <p className="max-w-[48ch] text-card text-on-hero-muted text-pretty">{t("home.hero.tell")}</p>
          <div className="grid gap-3 pt-1 sm:grid-cols-2">
            <Door
              to="/report"
              door="report"
              icon="send"
              look="bg-accent text-on-accent hover:bg-[color-mix(in_oklab,var(--accent),white_14%)]"
            />
            <Door
              to="/report?emergency=1"
              door="emergency"
              icon="triangleAlert"
              look="bg-signal text-on-signal hover:bg-signal-deep"
            />
          </div>
          <CallNow />
          <div className="-mx-3 flex flex-wrap">
            <Link to="/missing" aria-labelledby="door-missing" className={quietLink}>
              <Icon name="userSearch" className="size-5" />
              <span id="door-missing">{t("home.door.missing")}</span>
            </Link>
            <a href={sent ? "#my-reports" : "#steps"} className={quietLink}>
              <Icon name="chevronRight" className="size-5" />
              {t(sent ? "home.reports.check" : "home.flow.link")}
            </a>
          </div>
        </div>
        <SigapDemo />
      </div>
    </section>
  );
}
