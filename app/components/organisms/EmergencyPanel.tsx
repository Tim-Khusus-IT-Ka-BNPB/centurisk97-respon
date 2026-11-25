import { Link } from "react-router";
import { useText } from "../../lib/text";
import { buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";

// Above the start page of an emergency: that the way is short, and the number that is shorter.
export function EmergencyStart() {
  const t = useText();
  return (
    <section
      aria-labelledby="emergency-start"
      className="flex flex-col gap-3 rounded-card border border-signal bg-signal-tint p-4"
    >
      <h1 id="emergency-start" className="text-card font-bold">
        {t("emergency.start")}
      </h1>
      <p>{t("emergency.startLead")}</p>
      <a href="tel:112" className={buttonStyles({ variant: "signal", className: "self-start" })}>
        <Icon name="phone" className="size-5" />
        {t("notice.lifeLine.call")}
      </a>
    </section>
  );
}

// When a life is at risk a report waits too long: the number to call now, BNPB's call center, and
// for a reporter known on this phone one tap that sends its point.
export function EmergencyPanel({ known = false }: { readonly known?: boolean }) {
  const t = useText();
  return (
    <aside aria-labelledby="emergency-heading" className="flex flex-col gap-3 card-surface p-5 text-ink">
      <h2 id="emergency-heading" className="text-card font-bold">
        {t("about.emergency.title")}
      </h2>
      <p className="text-muted">{t("about.emergency.body")}</p>
      <a href={`tel:${t("about.emergency.112")}`} className={buttonStyles({ variant: "signal", size: "main" })}>
        {t("about.emergency.112Label")} {t("about.emergency.112")}
      </a>
      {known ? (
        <Link to="/lapor/darurat?ketuk=1" className={buttonStyles({ variant: "danger", size: "main" })}>
          <Icon name="mapPin" className="size-5" />
          {t("emergency.oneTap")}
        </Link>
      ) : null}
      <a
        href={`tel:${t("home.contact.callCenter")}`}
        className="inline-flex min-h-target-min items-center justify-between gap-3 border-t border-line pt-3"
      >
        <span className="text-muted">{t("home.contact.callCenterLabel")} BNPB</span>
        <span className="text-card font-bold tabular-nums underline">{t("home.contact.callCenter")}</span>
      </a>
    </aside>
  );
}
