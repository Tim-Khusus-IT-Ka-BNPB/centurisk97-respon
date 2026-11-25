import { Link } from "react-router";
import { useText } from "../../lib/text";
import { buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { CallRow } from "../molecules/CallRow";

// Above the start page of an emergency: that the way is short, and the number that is shorter.
export function EmergencyStart() {
  const t = useText();
  return (
    <section aria-labelledby="emergency-start" className="flex flex-col gap-4 rounded-card bg-signal-tint p-5 md:p-7">
      <div className="flex flex-col gap-2">
        <h1 id="emergency-start" className="flex items-center gap-2.5 text-page font-bold">
          <Icon name="triangleAlert" className="size-6 text-signal" />
          {t("emergency.start")}
        </h1>
        <p>{t("emergency.startLead")}</p>
      </div>
      <CallRow number="112" label={t("notice.lifeLine.call")} first />
    </section>
  );
}

// When a life is at risk a report waits too long: the number to call now, BNPB's call center, and
// for a reporter known on this phone one tap that sends its point.
export function EmergencyPanel({ known = false }: { readonly known?: boolean }) {
  const t = useText();
  return (
    <aside
      aria-labelledby="emergency-heading"
      className="flex flex-col gap-3 rounded-card bg-surface p-5 text-ink shadow-float"
    >
      <div className="flex flex-col gap-1 pb-1">
        <h2 id="emergency-heading" className="text-page font-bold">
          {t("about.emergency.title")}
        </h2>
        <p className="text-muted">{t("about.emergency.body")}</p>
      </div>
      <CallRow number={t("about.emergency.112")} label={t("about.emergency.112Label")} first />
      <CallRow number={t("home.contact.callCenter")} label={`${t("home.contact.callCenterLabel")} BNPB`} />
      {known ? (
        <Link to="/lapor/darurat?ketuk=1" className={buttonStyles({ variant: "danger", size: "main" })}>
          <Icon name="mapPin" className="size-5" />
          {t("emergency.oneTap")}
        </Link>
      ) : null}
    </aside>
  );
}
