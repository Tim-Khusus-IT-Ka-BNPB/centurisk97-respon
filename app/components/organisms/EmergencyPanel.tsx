import { useText } from "../../lib/text";
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

// When a life is at risk a report waits too long: the number to call now and BNPB's call center.
// One tap is no longer offered here (upstream, 25 Nov; owner, 26 Nov): "Lapor darurat" asks the
// little it needs, and the one-tap page stays for a report kept with no signal.
export function EmergencyPanel() {
  const t = useText();
  return (
    <aside
      aria-labelledby="emergency-heading"
      className="flex flex-col gap-3 rounded-card bg-surface p-5 text-ink shadow-float [--focus:var(--focus-page)]"
    >
      <div className="flex flex-col gap-1 pb-1">
        <h2 id="emergency-heading" className="text-page font-bold">
          {t("about.emergency.title")}
        </h2>
        <p className="text-muted">{t("about.emergency.body")}</p>
      </div>
      <CallRow number={t("about.emergency.112")} label={t("about.emergency.112Label")} first />
      <CallRow number={t("about.emergency.117")} label={t("about.emergency.117Label")} />
    </aside>
  );
}
