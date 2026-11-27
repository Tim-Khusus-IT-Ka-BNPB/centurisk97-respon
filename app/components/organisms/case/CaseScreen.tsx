import { Link, useSearchParams } from "react-router";
import type { CaseView } from "../../../../src/contract/cases";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { CASE_KINDS } from "../../../../src/domain/caseSpec";
import type { CaseTab } from "../../../lib/casePage.server";
import { cn } from "../../../lib/cn";
import { isLimit, problemOf } from "../../../lib/envelope";
import { limitText } from "../../../lib/status";
import { useText } from "../../../lib/text";
import { Notice } from "../../molecules/Notice";
import { chip } from "../FeedScreen";
import { CaseClosing } from "./CaseClosing";
import { CaseFileFields } from "./CaseFileFields";
import { CaseRecordCard } from "./CaseRecordCard";
import { CaseRecordForm } from "./CaseRecordForm";
import { CaseTeam } from "./CaseTeam";
import { CaseTotals } from "./CaseTotals";

export type CaseAnswered = {
  readonly envelope: ErrorEnvelope | null;
  readonly typed: Readonly<Record<string, string>> | null;
  readonly link: { readonly link: string; readonly name: string } | null;
  readonly revealed: { readonly recordId: string; readonly personal: Readonly<Record<string, unknown>> } | null;
};

const SAVED = ["record", "update", "cancel", "photo", "fields", "nil", "removeMember", "close", "accept", "reopen"];
// The fields of the screen's forms that are not a record's own.
const NOT_RECORD = new Set([
  "endedOn",
  "note",
  "name",
  "number",
  "reason",
  "metric",
  "post",
  "emergencyStatus",
  "decreeNumber",
  "decreeDate",
  "efforts",
  "personnel",
  "photo",
]);

// The BPBD's follow-up file (M09) for its keepers, its team, BNPB and its province: totals, a tab
// per kind with its records and form, the file's own values, and its team. Works with no script.
export function CaseScreen({
  view,
  tab,
  answered,
}: {
  readonly view: CaseView;
  readonly tab: CaseTab;
  readonly answered: CaseAnswered;
}) {
  const t = useText();
  const [search] = useSearchParams();
  const saved = search.get("saved");
  const { envelope } = answered;
  const mayWrite = (view.access === "lead" || view.access === "team") && view.file.status === "open";
  const records = view.records.filter((one) => one.kind === tab.kind);
  const editing = view.records.find((one) => one.id === tab.editing && one.cancelledReason === null) ?? null;
  // A refusal of a record's own value goes under its box; any other is told at the top.
  const general =
    envelope !== null && (envelope.fields.length === 0 || envelope.fields.every((one) => NOT_RECORD.has(one.fieldId)))
      ? envelope
      : null;
  const recordEnvelope = general === null ? envelope : null;
  return (
    <div className="flex flex-col gap-5">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{t("desk.case.ticket", { ticket: view.file.ticketNumber })}</span>
        <span className="rounded-chip bg-selected px-2 py-0.5 font-semibold text-primary">
          {t(`desk.case.status.${view.file.status}`)}
        </span>
        <span className="text-meta text-muted">{t(`desk.case.access.${view.access}`)}</span>
      </p>
      {saved !== null && SAVED.includes(saved) && envelope === null ? (
        <p role="status" className="font-semibold text-primary">
          {t(`desk.case.saved.${saved}`)}
        </p>
      ) : null}
      {general === null ? null : (
        <Notice kind="error">
          {isLimit(general)
            ? limitText(t, general, Date.now())
            : general.fields.length > 0
              ? t((problemOf(general, general.fields[0]?.fieldId as string) as { copyKey: string }).copyKey)
              : t(general.error.copyKey, general.error.params)}
        </Notice>
      )}
      <CaseTotals view={view} />
      <CaseClosing view={view} envelope={envelope} />
      {view.access === "province" ? null : (
        <>
          <nav aria-label={t("desk.case.tabs")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6">
            {CASE_KINDS.map((kind) => (
              <Link
                key={kind}
                to={`?kind=${kind}`}
                aria-current={tab.kind === kind ? "true" : undefined}
                className={cn(chip, "whitespace-nowrap")}
              >
                {t("desk.case.count", {
                  kind: `desk.case.kind.${kind}`,
                  count: view.records.filter((one) => one.kind === kind && one.cancelledReason === null).length,
                })}
              </Link>
            ))}
          </nav>
          {records.length === 0 ? (
            <p className="text-muted">{t("desk.case.none", { kind: `desk.case.kind.${tab.kind}` })}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {records.map((record) => (
                <CaseRecordCard
                  key={record.id}
                  fileId={view.file.id}
                  record={record}
                  records={view.records}
                  mayWrite={mayWrite}
                  mayReveal={view.access === "bnpb"}
                  revealed={answered.revealed?.recordId === record.id ? answered.revealed.personal : null}
                />
              ))}
            </ul>
          )}
          {mayWrite ? (
            <CaseRecordForm
              key={`${tab.kind}-${editing?.id ?? "new"}`}
              kind={tab.kind}
              records={view.records}
              editing={editing}
              envelope={recordEnvelope}
              typed={recordEnvelope === null ? null : answered.typed}
            />
          ) : null}
          <CaseFileFields view={view} envelope={envelope} />
          {view.access === "lead" || view.access === "bnpb" ? (
            <CaseTeam view={view} envelope={envelope} link={answered.link} />
          ) : null}
        </>
      )}
    </div>
  );
}
