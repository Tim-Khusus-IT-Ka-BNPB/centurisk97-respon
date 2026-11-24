import { Link } from "react-router";
import type { DraftBody } from "../../../src/contract/draft";
import { useText } from "../../lib/text";
import { clockTime, longDate } from "../../lib/time";
import { ProgressBar } from "../atoms/ProgressBar";

const heading = "text-meta font-semibold text-muted";

// Beside the conversation on a wide screen: how complete the report is, how long it is kept,
// the words that work in the message box, and the way to help.
export function DraftAside({ draft }: { readonly draft: DraftBody }) {
  const t = useText();
  const kept = draft.keptUntil;
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="aside-progress" className="card-surface flex flex-col gap-3 p-5">
        <h2 id="aside-progress" className={heading}>
          {t("chat.aside.progress")}
        </h2>
        <p className="text-card font-bold tabular-nums">
          {t("card.summary.complete", { percent: draft.completePercent })}
        </p>
        <ProgressBar percent={draft.completePercent} />
        <p className="text-meta text-muted tabular-nums">
          {t("resume.keptUntil", { time: clockTime(kept), zone: kept.zone, date: longDate(kept) })}
        </p>
      </section>
      <section aria-labelledby="aside-words" className="card-surface flex flex-col gap-2 p-5">
        <h2 id="aside-words" className={heading}>
          {t("about.words.title")}
        </h2>
        <ul className="flex flex-col gap-2 text-meta">
          <li>{t("about.words.back")}</li>
          <li>{t("about.words.cancel")}</li>
        </ul>
        <Link to="/lapor/help" className="inline-flex min-h-target-min items-center text-meta font-semibold underline">
          {t("chat.aside.help")}
        </Link>
      </section>
    </div>
  );
}
