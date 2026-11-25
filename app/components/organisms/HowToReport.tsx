import { ABOUT_STEPS } from "../../lib/docs";
import { useText } from "../../lib/text";
import { Step } from "../molecules/Step";

const APP = { appName: "app.name" };

// The steps of a report, in the order the reporter meets them.
export function HowToReport({ id = "steps" }: { readonly id?: string }) {
  const t = useText();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-6">
      <h2 id={id} className="scroll-mt-6 text-section font-bold tracking-[-0.015em]">
        {t("about.steps.title")}
      </h2>
      <ol className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-6 md:grid-cols-2 lg:grid-cols-3">
        {ABOUT_STEPS.map((step) => (
          <Step key={step} number={step} title={t(`about.step${step}.title`)} body={t(`about.step${step}.body`, APP)} />
        ))}
      </ol>
    </section>
  );
}
