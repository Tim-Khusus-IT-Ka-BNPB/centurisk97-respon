import { useText } from "../../lib/text";
import { buttonStyles } from "../atoms/Button";

// When a life is at risk a report waits too long: the number to call now, and BNPB's call center.
export function EmergencyPanel() {
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
