import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useText } from "../../lib/text";
import { Icon } from "../atoms/Icon";

// What each step looks like on the report's own screens, drawn small; the words beside it say it.
function Tell() {
  const t = useText();
  return (
    <p className="ms-auto max-w-[90%] rounded-[1.125rem] rounded-ee-chip bg-primary px-4 py-2.5 text-on-primary">
      {t("home.flow.tell.sample")}
    </p>
  );
}

function Complete() {
  const t = useText();
  const options = ["seen", "noneKnown", "unknown"] as const;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3.5">
      <p className="font-bold">{t("field.trapped.label")}</p>
      <ul className="flex flex-col gap-1.5 text-meta">
        {options.map((option, index) => (
          <li
            key={option}
            className={cn(
              "flex items-center gap-2 rounded-control border px-2.5 py-1.5",
              index === 0 ? "border-primary bg-selected font-semibold text-primary" : "border-line",
            )}
          >
            <span
              className={cn(
                "size-3.5 shrink-0 rounded-full border-2",
                index === 0 ? "border-primary bg-primary shadow-[inset_0_0_0_2px_var(--surface)]" : "border-control",
              )}
            />
            {t(`option.trapped.${option}.label`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Track() {
  const t = useText();
  const stages = [
    ["new", true],
    ["seen", true],
    ["in_handling", false],
  ] as const;
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3.5">
      <p className="flex flex-col">
        <span className="text-meta text-muted">{t("card.sent.number")}</span>
        <span className="text-card font-bold tabular-nums">LA-291126-07</span>
      </p>
      <ol className="flex flex-col gap-1.5 text-meta">
        {stages.map(([stage, reached]) => (
          <li key={stage} className={cn("flex items-center gap-2", reached ? "" : "font-semibold text-primary")}>
            {reached ? (
              <Icon name="circleCheck" className="size-4 text-primary" />
            ) : (
              <Icon name="circleDot" className="size-4" />
            )}
            {t(`stage.short.${stage}`)}
          </li>
        ))}
      </ol>
    </div>
  );
}

const STEPS: readonly { readonly key: string; readonly scene: () => ReactNode }[] = [
  { key: "tell", scene: Tell },
  { key: "complete", scene: Complete },
  { key: "track", scene: Track },
];

// How a report goes: told in one's own words, completed with Sigap, received by the BPBD, each shown
// as it looks on the report's own screens.
export function HomeFlow() {
  const t = useText();
  return (
    <section aria-labelledby="steps" className="flex flex-col gap-6">
      <h2 id="steps" className="scroll-mt-6 text-section font-bold tracking-[-0.015em]">
        {t("home.flow.title")}
      </h2>
      {/* Side by side, the drawings share one row's height and the words start on one line. */}
      <ol className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-10 md:grid-cols-3 md:grid-rows-[auto_auto] md:gap-y-4">
        {STEPS.map(({ key, scene: Scene }) => (
          <li key={key} className="flex flex-col gap-4 md:row-span-2 md:grid md:grid-rows-subgrid">
            <div aria-hidden="true" className="flex min-h-44 flex-col justify-center rounded-[1.25rem] bg-sunken p-4">
              <Scene />
            </div>
            <div className="flex flex-col gap-1.5">
              <h3 className="text-card font-bold">{t(`home.flow.${key}.title`)}</h3>
              <p className="max-w-[40ch] text-muted">{t(`home.flow.${key}.body`)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
