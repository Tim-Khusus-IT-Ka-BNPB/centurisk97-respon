import { Form } from "react-router";
import type { CaseView } from "../../../../src/contract/cases";
import { useText } from "../../../lib/text";
import { Button } from "../../atoms/Button";

const SHOWN = [
  "dead",
  "missing",
  "injured",
  "displaced",
  "housesHeavy",
  "housesModerate",
  "housesLight",
  "housesFlooded",
  "infrastructureCut",
] as const;

// The file's totals counted from its records (D5): empty is not yet recorded, never 0; the keepers
// mark a metric none when it has no record (D15).
export function CaseTotals({ view }: { readonly view: CaseView }) {
  const t = useText();
  const mayMark = view.access === "lead" && view.file.status === "open";
  const extra = Object.keys(view.recap).filter(
    (metric) => !SHOWN.some((one) => one === metric) && t.has(`desk.case.metric.${metric}`),
  );
  return (
    <section aria-labelledby="case-totals" className="flex flex-col gap-3 card-surface p-4 md:p-5">
      <div className="flex flex-col gap-1">
        <h2 id="case-totals" className="text-card font-bold">
          {t("desk.case.totals", { day: view.day })}
        </h2>
        <p className="text-meta text-muted">{t("desk.case.totals.lead")}</p>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {[...SHOWN, ...extra].map((metric) => {
          const value = view.recap[metric] ?? null;
          const marked = view.file.nil.includes(metric);
          return (
            <div
              key={metric}
              className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-sunken p-3"
            >
              <dt className="text-meta">{t(`desk.case.metric.${metric}`)}</dt>
              <dd className="flex items-center gap-2">
                <span className="font-bold tabular-nums">
                  {value === null ? t("desk.case.notRecorded") : marked ? t("desk.case.nil.marked") : value}
                </span>
                {mayMark && !view.filled.includes(metric) && metric !== "displaced" ? (
                  <Form method="post" replace preventScrollReset>
                    <input type="hidden" name="intent" value="nil" />
                    <input type="hidden" name="metric" value={metric} />
                    <input type="hidden" name="nil" value={marked ? "0" : "1"} />
                    <input type="hidden" name="revision" value={view.file.revision} />
                    <Button variant="link" size="min" className="text-meta">
                      {t(marked ? "desk.case.nil.unmark" : "desk.case.nil.mark")}
                    </Button>
                  </Form>
                ) : null}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
