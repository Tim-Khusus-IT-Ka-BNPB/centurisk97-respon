import { useState } from "react";
import { Link, useLocation, useRevalidator } from "react-router";
import { FAILED_TEXTS } from "../../lib/failedTexts";
import { useText } from "../../lib/text";
import { buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { WithTexts } from "../templates/Page";
import { EmergencyPanel } from "./EmergencyPanel";
import { SiteHeader } from "./SiteHeader";

// A link, so it works with no script. With script it asks for the page again in place: with the
// signal still gone, the browser's own error page would take this one and its numbers away.
function Reload() {
  const t = useText();
  const { pathname, search } = useLocation();
  const { state, revalidate } = useRevalidator();
  const [tried, setTried] = useState(false);
  const busy = state === "loading";
  return (
    <>
      <a
        href={`${pathname}${search}`}
        aria-disabled={busy ? true : undefined}
        onClick={(event) => {
          event.preventDefault();
          if (busy) return;
          setTried(true);
          revalidate();
        }}
        className={buttonStyles({ variant: "accent", size: "main", className: "px-7" })}
      >
        <Icon name="rotateCw" className="size-5" />
        {t(busy ? "failed.busy" : "failed.reload")}
      </a>
      <p role="status" className="order-last basis-full text-on-hero empty:hidden">
        {tried && !busy ? t("failed.still") : null}
      </p>
    </>
  );
}

function Failed() {
  const t = useText();
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader nav={false} width="max-w-[72rem]" languages={false} />
      <main className="contours flex flex-1 flex-col text-on-hero">
        <div className="mx-auto grid w-full max-w-[72rem] grid-cols-[minmax(0,1fr)] gap-9 px-4 py-10 md:px-6 md:py-16 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-center lg:gap-20 lg:py-24">
          <div className="flex flex-col gap-5">
            <div role="alert" className="flex flex-col gap-5">
              <h1 className="max-w-[19ch] text-display font-extrabold tracking-[-0.02em] text-balance">
                {t("failed.title")}
              </h1>
              <p className="max-w-[52ch] text-card text-on-hero-muted text-pretty">{t("failed.lead")}</p>
            </div>
            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Reload />
              <Link to="/lapor" className={buttonStyles({ variant: "onHero", size: "main", className: "px-7" })}>
                {t("failed.home")}
              </Link>
            </div>
          </div>
          <EmergencyPanel />
        </div>
      </main>
    </div>
  );
}

// In place of a page that cannot be shown: its data did not come, or drawing it failed.
export const FailedScreen = () => (
  <WithTexts texts={FAILED_TEXTS}>
    <Failed />
  </WithTexts>
);
