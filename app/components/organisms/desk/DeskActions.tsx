import { useState } from "react";
import { Form, useNavigation } from "react-router";
import type { DeskReport } from "../../../../src/contract/desk";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import type { DeskTyped } from "../../../lib/deskTypes";
import { firstInvalid, problemOf } from "../../../lib/envelope";
import { useFocusOnChange } from "../../../lib/hooks";
import { type Text, useText } from "../../../lib/text";
import { Button } from "../../atoms/Button";
import { Textarea } from "../../atoms/controls";
import { Field } from "../../molecules/Field";
import { type Status, StatusDot, when } from "./parts";

type FormProps = {
  readonly report: DeskReport;
  readonly envelope: ErrorEnvelope | null;
  // What was typed in a refused change, so nothing is lost without script.
  readonly typed: DeskTyped | null;
};

const useBusy = (action: string) => {
  const t = useText();
  return useNavigation().formData?.get("action") === action ? t("desk.busy") : null;
};

// Where a move goes, in words: back to its review, or to the desk of the report's own place.
function moveLabel(t: Text, report: DeskReport, to: Status): string {
  if (report.status === "closed" || report.status === "invalid") return t("desk.move.reopen");
  return to === "forwarded" ? t("desk.move.forward", { regency: report.place.regencyName }) : t(`stage.long.${to}`);
}

// Only the statuses the ticket may go to from here; what the note must hold follows the one picked.
function StatusForm({ report, envelope, typed }: FormProps) {
  const t = useText();
  const only = report.nextStatuses.length === 1 ? report.nextStatuses[0]?.status : undefined;
  const [picked, setPicked] = useState<string | undefined>(typed?.to || only);
  const rule = report.nextStatuses.find((next) => next.status === picked)?.note ?? "any";
  const busyLabel = useBusy("status");
  return (
    <Form method="post" preventScrollReset className="flex flex-col gap-4">
      <input type="hidden" name="action" value="status" />
      <input type="hidden" name="revision" value={report.revision} />
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 font-bold">{t("desk.move")}</legend>
        {report.nextStatuses.map(({ status }) => (
          <label
            key={status}
            className="flex min-h-target cursor-pointer items-center gap-3 rounded-control border border-line bg-surface px-3 py-2 hover:bg-sunken has-checked:border-primary has-checked:bg-selected has-checked:font-semibold has-focus-visible:outline-2 has-focus-visible:outline-focus"
          >
            <input
              type="radio"
              name="to"
              value={status}
              required
              defaultChecked={picked === status}
              onChange={() => setPicked(status)}
              className="size-5 shrink-0"
            />
            <StatusDot status={status} />
            {moveLabel(t, report, status)}
          </label>
        ))}
      </fieldset>
      <Field
        id="note"
        label={t(rule === "any" ? "desk.move.note.optional" : `desk.move.note.${rule}`)}
        hint={t(`desk.move.hint.${rule}`)}
        problem={problemOf(envelope, "note")}
        focus={problemOf(envelope, "note") !== null}
      >
        {(control) => <Textarea {...control} rows={3} defaultValue={typed?.note} />}
      </Field>
      <Button type="submit" variant="primary" className="self-start" busyLabel={busyLabel}>
        {t("desk.move.submit")}
      </Button>
    </Form>
  );
}

function ReplyForm({ envelope, typed }: Omit<FormProps, "report">) {
  const t = useText();
  const busyLabel = useBusy("reply");
  return (
    <Form method="post" preventScrollReset className="flex flex-col gap-4">
      <input type="hidden" name="action" value="reply" />
      <Field
        id="reply"
        label={t("desk.reply")}
        hint={t("desk.reply.hint")}
        problem={problemOf(envelope, "reply")}
        focus={problemOf(envelope, "reply") !== null}
      >
        {(control) => <Textarea {...control} rows={3} defaultValue={typed?.reply} />}
      </Field>
      <Button type="submit" variant="secondary" className="self-start" busyLabel={busyLabel}>
        {t("desk.reply.submit")}
      </Button>
    </Form>
  );
}

// What an officer does with a report: move its ticket, and write back. Each form starts empty
// again once its change is kept.
export function DeskActions({ report, envelope, typed }: FormProps) {
  const t = useText();
  useFocusOnChange(firstInvalid(envelope, ["note", "reply"]), envelope);
  return (
    <>
      {report.nextStatuses.length === 0 ? (
        <p className="text-muted">{t("desk.move.notSeen")}</p>
      ) : (
        <StatusForm key={`status-${report.revision}`} report={report} envelope={envelope} typed={typed} />
      )}
      <div className="flex flex-col gap-4 border-t border-line pt-5">
        <ReplyForm key={`reply-${report.replies.length}`} envelope={envelope} typed={typed} />
        {report.replies.length === 0 ? null : (
          <div className="flex flex-col gap-3">
            <h3 className="font-bold">{t("desk.replies", { count: report.replies.length })}</h3>
            <ol className="flex flex-col gap-3">
              {report.replies.map((one, index) => (
                // Two replies may share a time, so their order is their key.
                // biome-ignore lint/suspicious/noArrayIndexKey: the list is append-only and never reordered
                <li key={index} className="flex flex-col gap-0.5 rounded-control bg-selected px-3 py-2">
                  <span className="break-words whitespace-pre-line">{one.text}</span>
                  <span className="text-meta text-muted tabular-nums">
                    {t("desk.reply.by", { actor: one.actor, at: when(t, "desk.history.at", one.at) })}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </>
  );
}
