import type { DeskReport } from "../../../../src/contract/desk";
import { hazardOf, rowParts } from "../../../../src/copy/values";
import { useText } from "../../../lib/text";
import { StateMark } from "../cards/SummaryCards";

type Row = DeskReport["groups"][number]["rows"][number];

// One value: what was asked, what is known of it, and at the end of the line where it came from;
// on a phone a long value takes its line alone.
function ValueRow({ row, hazardType }: { readonly row: Row; readonly hazardType: Parameters<typeof rowParts>[2] }) {
  const t = useText();
  const parts = rowParts(t, row, hazardType);
  const origin = row.state === "notYetKnown" ? null : row.origin;
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 py-2.5 sm:grid sm:grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_auto] sm:gap-x-6 md:px-5">
      <dt className="basis-full text-meta text-muted sm:text-body">{parts.label}</dt>
      <dd className="min-w-0 flex-auto break-words">
        {parts.value === null ? (
          <StateMark state={parts.state as "none" | "confirmedUnknown" | "notYetKnown"} />
        ) : (
          parts.value
        )}
        {row.quote === null ? null : <q className="block text-meta text-muted italic">{row.quote}</q>}
        {row.translation === null ? null : (
          <span className="block text-meta text-muted">{t("desk.translated", { text: row.translation })}</span>
        )}
      </dd>
      {origin === null ? null : <dd className="text-meta text-muted sm:text-end">{t(`desk.origin.${origin}`)}</dd>}
    </div>
  );
}

// Every value the report holds, by its groups, each with where it came from.
export function DeskValues({ report }: { readonly report: DeskReport }) {
  const t = useText();
  const hazardType = hazardOf(report.groups);
  return (
    <section aria-labelledby="desk-values" className="overflow-hidden card-surface">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-4 md:px-5">
        <h2 id="desk-values" className="scroll-mt-24 text-card font-bold">
          {t("desk.values")}
        </h2>
        <p className="text-meta text-muted">{t("desk.complete", { percent: report.completePercent })}</p>
      </div>
      {report.groups.map((group) => (
        <div key={group.groupId}>
          <h3 className="border-y border-line bg-sunken/60 px-4 py-2 text-meta font-semibold md:px-5">
            {t(`group.${group.groupId}.label`)}
          </h3>
          <dl className="divide-y divide-line">
            {group.rows.map((row) => (
              <ValueRow key={row.fieldId} row={row} hazardType={hazardType} />
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}
