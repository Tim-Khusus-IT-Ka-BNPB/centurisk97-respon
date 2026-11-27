import { useEffect, useRef, useState } from "react";
import type { SigapScene } from "../../lib/sigap";
import { useText } from "../../lib/text";
import { Button } from "../atoms/Button";
import { Sigap } from "../molecules/Sigap";

type Step = { readonly key: string; readonly target: string | null; readonly scene: SigapScene };

// Upstream's home tour (K82), started from Sigap's bubble: each part of the home in turn, lit
// inside a dimmed page. A part the screen does not show, as a phone hides the header's language,
// is left out.
const TOUR: readonly Step[] = [
  { key: "welcome", target: null, scene: "greet" },
  { key: "emergency", target: '[aria-labelledby="door-emergency"]', scene: "emergency" },
  { key: "report", target: '[aria-labelledby="door-report"]', scene: "report" },
  { key: "missing", target: '[aria-labelledby="door-missing"]', scene: "missing" },
  { key: "info", target: '[aria-labelledby="door-info"]', scene: "info" },
  { key: "education", target: '[aria-labelledby="door-education"]', scene: "learn" },
  { key: "numbers", target: '[aria-labelledby="door-numbers"]', scene: "numbers" },
  { key: "language", target: 'header a[href^="/language"]', scene: "language" },
  { key: "reports", target: "#my-reports", scene: "reports" },
];

const shown = (selector: string) =>
  [...document.querySelectorAll(selector)].find((one) => one.getClientRects().length > 0) ?? null;

const PAD = 6;

export function SigapTour({ onClose }: { readonly onClose: () => void }) {
  const t = useText();
  const dialog = useRef<HTMLDialogElement>(null);
  const [steps] = useState(() => TOUR.filter((step) => step.target === null || shown(step.target) !== null));
  const [at, setAt] = useState(0);
  const light = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState(false);
  const step = steps[at] as Step;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const target = step.target === null ? null : shown(step.target);
    target?.scrollIntoView({ block: "center" });
    setLit(target !== null);
  }, [step]);
  // The light follows its part as the page scrolls or turns, without a render each time.
  useEffect(() => {
    const target = lit && step.target !== null ? shown(step.target) : null;
    if (target === null) return;
    const measure = () => {
      const rect = target.getBoundingClientRect();
      const style = (light.current as HTMLDivElement).style;
      style.top = `${rect.top - PAD}px`;
      style.left = `${rect.left - PAD}px`;
      style.width = `${rect.width + 2 * PAD}px`;
      style.height = `${rect.height + 2 * PAD}px`;
    };
    measure();
    addEventListener("resize", measure);
    addEventListener("scroll", measure, true);
    return () => {
      removeEventListener("resize", measure);
      removeEventListener("scroll", measure, true);
    };
  }, [step, lit]);
  const last = at === steps.length - 1;
  return (
    <dialog
      ref={dialog}
      aria-labelledby="tour-title"
      onClose={onClose}
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 backdrop:bg-transparent"
    >
      {lit ? (
        <div
          ref={light}
          aria-hidden="true"
          className="pointer-events-none fixed rounded-[1.25rem] shadow-[0_0_0_100vmax_rgb(0_0_0/0.55)] ring-4 ring-accent"
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-[rgb(0_0_0/0.55)]" />
      )}
      <div className="fixed inset-x-4 bottom-4 mx-auto flex max-w-md items-end gap-2">
        <Sigap key={step.key} scene={step.scene} className="size-24 sm:size-28" />
        <section className="mb-2 flex min-w-0 flex-1 flex-col gap-2 rounded-2xl rounded-bl-sm bg-surface p-4 text-ink shadow-xl">
          <p className="text-meta text-muted tabular-nums">{t("sigap.tour.of", { n: at + 1, total: steps.length })}</p>
          <h2 id="tour-title" className="text-card font-bold">
            {t(`sigap.tour.${step.key}.title`)}
          </h2>
          <p className="text-meta">{t(`sigap.tour.${step.key}.text`)}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              variant="primary"
              size="min"
              onClick={() => (last ? dialog.current?.close() : setAt(at + 1))}
            >
              {t(last ? "sigap.tour.done" : "sigap.tour.next")}
            </Button>
            {at > 0 ? (
              <Button type="button" variant="secondary" size="min" onClick={() => setAt(at - 1)}>
                {t("sigap.tour.back")}
              </Button>
            ) : null}
            {last ? null : (
              <Button
                type="button"
                variant="quiet"
                size="min"
                className="ms-auto"
                onClick={() => dialog.current?.close()}
              >
                {t("sigap.tour.skip")}
              </Button>
            )}
          </div>
        </section>
      </div>
    </dialog>
  );
}
