import { useText } from "../../lib/text";
import { Icon } from "../atoms/Icon";
import type { IconName } from "../atoms/icons";

const STEPS: readonly { readonly key: string; readonly icon: IconName }[] = [
  { key: "tell", icon: "messageSquare" },
  { key: "complete", icon: "clipboardCheck" },
  { key: "track", icon: "landmark" },
];

// How a report goes, in three steps: told in one's own words, completed with Sigap, received by the BPBD.
export function HomeFlow() {
  const t = useText();
  return (
    <section aria-labelledby="steps" className="flex flex-col gap-6">
      <h2 id="steps" className="scroll-mt-6 text-section font-bold tracking-[-0.015em]">
        {t("home.flow.title")}
      </h2>
      <ol className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.key} className="flex flex-col gap-3 border-t-2 border-line pt-5">
            <span className="flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-selected text-primary">
                <Icon name={step.icon} className="size-6" />
              </span>
              <span
                aria-hidden="true"
                className="text-meta font-extrabold tracking-[0.12em] text-accent-ink tabular-nums"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
            </span>
            <h3 className="text-card font-bold">{t(`home.flow.${step.key}.title`)}</h3>
            <p className="max-w-[40ch] text-muted">{t(`home.flow.${step.key}.body`)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
