import { type ReactNode, useRef, useState } from "react";
import { Form, useNavigation, useSubmit } from "react-router";
import type { DeskReport } from "../../../../src/contract/desk";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { CHECK_RESULTS } from "../../../../src/domain/fieldCheck";
import { PROOF } from "../../../../src/domain/handling";
import type { DeskTyped } from "../../../lib/deskTypes";
import { photoFix, preparePhoto } from "../../../lib/device";
import { errorIdOf, firstInvalid, problemOf } from "../../../lib/envelope";
import { useFocusOnChange, useHydrated } from "../../../lib/hooks";
import { type Text, useText } from "../../../lib/text";
import { Button, buttonStyles } from "../../atoms/Button";
import { Input, Textarea } from "../../atoms/controls";
import { Icon } from "../../atoms/Icon";
import type { IconName } from "../../atoms/icons";
import { Field, FieldError } from "../../molecules/Field";
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

const pick =
  "flex min-h-target cursor-pointer items-center gap-3 rounded-control border border-line bg-surface px-3 py-2 hover:bg-sunken has-checked:border-primary has-checked:bg-selected has-checked:font-semibold has-focus-visible:outline-2 has-focus-visible:outline-focus";

// One piece of work, folded until wanted; it opens with a refusal inside it.
function Fold({
  icon,
  title,
  open,
  children,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly open: boolean;
  readonly children: ReactNode;
}) {
  return (
    <details open={open} className="group/fold border-t border-line first:border-t-0">
      <summary className="flex min-h-target list-none items-center gap-3 py-3 font-bold hover:text-primary [&::-webkit-details-marker]:hidden">
        <Icon name={icon} className="size-5 text-muted" />
        {title}
        <Icon name="chevronRight" className="ms-auto size-5 text-muted group-open/fold:rotate-90" />
      </summary>
      <div className="flex flex-col gap-4 pb-5">{children}</div>
    </details>
  );
}

// Where a move goes, in words: back to its review, or to the desk of the report's own place.
function moveLabel(t: Text, report: DeskReport, to: Status): string {
  if (report.status === "closed" || report.status === "invalid") return t("desk.move.reopen");
  return to === "forwarded" ? t("desk.move.forward", { regency: report.place.regencyName }) : t(`stage.long.${to}`);
}

// What is being done: the hazard's actions as boxes, and the officer's own words.
function ActionFields({ report, envelope, typed }: FormProps) {
  const t = useText();
  const problem = problemOf(envelope, "actions");
  const told = new Set(report.actions.map((action) => action.label));
  const offered = report.offeredActions.filter((action) => !told.has(action.label));
  return (
    <>
      {offered.length === 0 ? null : (
        <fieldset aria-describedby={problem ? errorIdOf("actions") : undefined} className="flex min-w-0 flex-col gap-2">
          <legend className="pb-2 font-semibold">{t("desk.actions.legend")}</legend>
          <div className="grid grid-cols-2 gap-x-2">
            {offered.map((action, index) => (
              <label
                key={action.code}
                className="flex min-h-target-min cursor-pointer items-center gap-2.5 rounded-control px-2 py-1 text-meta hover:bg-sunken has-checked:bg-selected has-checked:font-semibold has-focus-visible:outline-2 has-focus-visible:outline-focus"
              >
                <input
                  id={index === 0 ? "actions" : undefined}
                  autoFocus={index === 0 && problem !== null}
                  type="checkbox"
                  name="actions"
                  value={action.code}
                  defaultChecked={typed?.actions.includes(action.code)}
                  className="size-4 shrink-0"
                />
                {action.label}
              </label>
            ))}
          </div>
          <FieldError id="actions" problem={problem} />
        </fieldset>
      )}
      <Field
        id="otherAction"
        label={t("desk.actions.other")}
        hint={t("desk.actions.otherHint")}
        problem={problemOf(envelope, "otherAction") ?? (offered.length === 0 ? problem : null)}
        focus={problemOf(envelope, "otherAction") !== null || (offered.length === 0 && problem !== null)}
      >
        {(control) => <Input {...control} defaultValue={typed?.values.otherAction} autoComplete="off" />}
      </Field>
    </>
  );
}

// Only the statuses the ticket may go to from here; what is asked follows the one picked.
function StatusForm({ report, envelope, typed }: FormProps) {
  const t = useText();
  const hydrated = useHydrated();
  const only = report.nextStatuses.length === 1 ? report.nextStatuses[0]?.status : undefined;
  const [picked, setPicked] = useState<string | undefined>(typed?.values.to || only);
  const rule = report.nextStatuses.find((next) => next.status === picked)?.note ?? "any";
  const starts = report.nextStatuses.some((next) => next.status === "in_handling");
  const busyLabel = useBusy("status");
  return (
    <Form method="post" preventScrollReset className="flex flex-col gap-4">
      <input type="hidden" name="action" value="status" />
      <input type="hidden" name="revision" value={report.revision} />
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{t("desk.move")}</legend>
        {report.nextStatuses.map(({ status }) => (
          <label key={status} className={pick}>
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
      {starts ? (
        <div hidden={hydrated && picked !== "in_handling"} className="flex flex-col gap-4">
          <ActionFields report={report} envelope={envelope} typed={typed} />
        </div>
      ) : null}
      <Field
        id="note"
        label={t(rule === "any" ? "desk.move.note.optional" : `desk.move.note.${rule}`)}
        hint={t(rule === "closing" && report.proofs.length > 0 ? "desk.move.hint.optional" : `desk.move.hint.${rule}`)}
        problem={problemOf(envelope, "note")}
        focus={problemOf(envelope, "note") !== null}
      >
        {(control) => <Textarea {...control} rows={3} defaultValue={typed?.values.note} />}
      </Field>
      <Button type="submit" variant="primary" className="self-start" busyLabel={busyLabel}>
        {t("desk.move.submit")}
      </Button>
    </Form>
  );
}

// More done while the work goes on.
function AddActions(props: FormProps) {
  const t = useText();
  const busyLabel = useBusy("actions");
  return (
    <Form method="post" preventScrollReset className="flex flex-col gap-4">
      <input type="hidden" name="action" value="actions" />
      <ActionFields {...props} />
      <Button type="submit" variant="secondary" className="self-start" busyLabel={busyLabel}>
        {t("desk.actions.add")}
      </Button>
    </Form>
  );
}

// Photos of the work. With no script it is a file box and a button; with script a photo goes as
// soon as it is picked, shrunk, with the officer's reading.
function ProofForm({ report, envelope }: Omit<FormProps, "typed">) {
  const t = useText();
  const hydrated = useHydrated();
  const submit = useSubmit();
  const sending = useBusy("proof");
  const [preparing, setPreparing] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const problem = unreadable ? { copyKey: "fieldError.photo.unreadable", params: {} } : problemOf(envelope, "proof");
  const send = async (file: File) => {
    setPreparing(true);
    const [bytes, reading] = await Promise.all([preparePhoto(file), photoFix()]);
    setPreparing(false);
    setUnreadable(bytes === null);
    if (bytes === null) return;
    const body = new FormData();
    body.set("action", "proof");
    body.set("photo", new File([new Uint8Array(bytes)], "foto.jpg", { type: "image/jpeg" }));
    if (reading !== null) for (const [name, value] of Object.entries(reading)) body.set(name, String(value));
    submit(body, { method: "post", encType: "multipart/form-data", replace: true, preventScrollReset: true });
  };
  const busy = preparing || sending !== null;
  if (report.proofs.length >= PROOF.max) return <p className="text-meta">{t("desk.proof.full", { max: PROOF.max })}</p>;
  return (
    <Form ref={form} method="post" encType="multipart/form-data" preventScrollReset className="flex flex-col gap-2">
      <input type="hidden" name="action" value="proof" />
      <p className="text-meta text-muted">{t("desk.proof.hint", { count: report.proofs.length, max: PROOF.max })}</p>
      <label
        htmlFor="proof"
        aria-disabled={busy ? true : undefined}
        className={buttonStyles({ variant: "secondary", className: "cursor-pointer self-start" })}
      >
        <Icon name="camera" className="size-5" />
        {busy ? t("desk.proof.busy") : t("desk.proof.take")}
      </label>
      <input
        id="proof"
        name="photo"
        type="file"
        accept="image/jpeg"
        required
        disabled={busy}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? errorIdOf("proof") : undefined}
        className={hydrated ? "sr-only" : "text-body"}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          event.currentTarget.value = "";
          void send(file);
        }}
      />
      {hydrated ? null : (
        <Button variant="secondary" className="self-start">
          {t("desk.proof.submit")}
        </Button>
      )}
      <FieldError id="proof" problem={problem} />
    </Form>
  );
}

// What an officer found on site. The figures show once the report is found partly right.
function CheckForm({ report, envelope, typed }: FormProps) {
  const t = useText();
  const hydrated = useHydrated();
  const [picked, setPicked] = useState(typed?.values.result);
  const busyLabel = useBusy("check");
  const resultProblem = problemOf(envelope, "result");
  return (
    <Form method="post" preventScrollReset className="flex flex-col gap-4">
      <input type="hidden" name="action" value="check" />
      <input type="hidden" name="revision" value={report.revision} />
      <fieldset aria-describedby={resultProblem ? errorIdOf("result") : undefined} className="flex flex-col gap-2">
        <legend className="sr-only">{t("desk.check.result")}</legend>
        {CHECK_RESULTS.map((result, index) => (
          <label key={result} className={pick}>
            <input
              id={index === 0 ? "result" : undefined}
              autoFocus={index === 0 && resultProblem !== null}
              type="radio"
              name="result"
              value={result}
              required
              defaultChecked={picked === result}
              onChange={() => setPicked(result)}
              className="size-5 shrink-0"
            />
            <span className="flex flex-col">
              {t(`desk.check.result.${result}`)}
              <span className="text-meta font-normal text-muted">{t(`desk.check.resultHint.${result}`)}</span>
            </span>
          </label>
        ))}
        <FieldError id="result" problem={resultProblem} />
      </fieldset>
      <fieldset hidden={hydrated && picked !== "partly"} className="min-w-0">
        <legend className="pb-2 font-semibold">{t("desk.check.figures")}</legend>
        <div className="grid grid-cols-2 items-end gap-3">
          {report.revisable.map(({ fieldId, unit, count }) => (
            <Field
              key={fieldId}
              id={fieldId}
              label={t(`field.${fieldId}.label`)}
              unit={t(`unit.${unit}`)}
              problem={problemOf(envelope, fieldId)}
              focus={problemOf(envelope, fieldId) !== null}
            >
              {(control) => (
                <Input
                  {...control}
                  name={`box.${fieldId}`}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={t("desk.impact.unknown")}
                  defaultValue={typed?.values[`box.${fieldId}`] ?? count ?? ""}
                />
              )}
            </Field>
          ))}
        </div>
      </fieldset>
      <Field
        id="checkNote"
        label={t("desk.check.note")}
        hint={t("desk.check.noteHint")}
        problem={problemOf(envelope, "checkNote")}
        focus={problemOf(envelope, "checkNote") !== null}
      >
        {(control) => <Textarea {...control} rows={3} defaultValue={typed?.values.checkNote} />}
      </Field>
      <Button type="submit" variant="secondary" className="self-start" busyLabel={busyLabel}>
        {t("desk.check.submit")}
      </Button>
    </Form>
  );
}

function ReplyForm({ report, envelope, typed }: FormProps) {
  const t = useText();
  const busyLabel = useBusy("reply");
  return (
    <>
      <Form method="post" preventScrollReset className="flex flex-col gap-4">
        <input type="hidden" name="action" value="reply" />
        <Field
          id="reply"
          label={t("desk.reply.label")}
          hint={t("desk.reply.hint")}
          problem={problemOf(envelope, "reply")}
          focus={problemOf(envelope, "reply") !== null}
        >
          {(control) => <Textarea {...control} rows={3} defaultValue={typed?.values.reply} />}
        </Field>
        <Button type="submit" variant="secondary" className="self-start" busyLabel={busyLabel}>
          {t("desk.reply.submit")}
        </Button>
      </Form>
      {report.replies.length === 0 ? null : (
        <div className="flex flex-col gap-3">
          <h3 className="font-bold">{t("desk.replies")}</h3>
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
    </>
  );
}

// What an officer does with a report, one fold per piece of work. Each form starts empty again
// once its change is kept, so its key is what the change moves.
export function DeskActions(props: FormProps) {
  const t = useText();
  const { report, envelope } = props;
  const figures = report.revisable.map((one) => one.fieldId);
  const order = ["actions", "otherAction", "note", "result", ...figures, "checkNote", "proof", "reply"];
  const invalid = firstInvalid(envelope, order);
  useFocusOnChange(invalid, envelope);
  const inside = (fields: readonly string[]) => invalid !== null && fields.includes(invalid);
  const handled = report.status === "in_handling";
  const done = report.status === "closed" || report.status === "invalid";
  const work = `${report.revision}-${report.actions.length}-${report.proofs.length}`;
  return (
    <div className="flex flex-col">
      <Fold icon="circleCheck" title={t("desk.move")} open>
        {report.nextStatuses.length === 0 ? (
          <p className="text-muted">{t(report.status === "new" ? "desk.move.notSeen" : "desk.move.none")}</p>
        ) : (
          <StatusForm key={`status-${report.revision}`} {...props} />
        )}
      </Fold>
      {handled ? (
        <>
          <Fold icon="camera" title={t("desk.proof")} open>
            <ProofForm key={`proof-${work}`} report={report} envelope={envelope} />
          </Fold>
          <Fold icon="wrench" title={t("desk.actions.add")} open={inside(["actions", "otherAction"])}>
            <AddActions key={`actions-${work}`} {...props} />
          </Fold>
        </>
      ) : null}
      {done ? null : (
        <Fold icon="clipboardCheck" title={t("desk.check")} open={inside(["result", "checkNote", ...figures])}>
          <CheckForm key={`check-${report.revision}`} {...props} />
        </Fold>
      )}
      <Fold
        icon="messageSquare"
        title={t(report.replies.length === 0 ? "desk.reply" : "desk.reply.counted", { count: report.replies.length })}
        open={inside(["reply"])}
      >
        <ReplyForm key={`reply-${report.replies.length}`} {...props} />
      </Fold>
    </div>
  );
}
