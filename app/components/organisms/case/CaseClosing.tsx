import { Form, useNavigation } from "react-router";
import type { CaseView } from "../../../../src/contract/cases";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { problemOf } from "../../../lib/envelope";
import { useText } from "../../../lib/text";
import { Button } from "../../atoms/Button";
import { Input, Textarea } from "../../atoms/controls";
import { Field } from "../../molecules/Field";
import { when } from "../desk/parts";

// What keeps an event from ending clean (D13): each reason, a count or not yet recorded.
function Reasons({ final }: { readonly final: CaseView["final"] }) {
  const t = useText();
  return (
    <ul className="flex list-disc flex-col gap-1 ps-5 text-meta">
      {final.reasons.map((reason) => (
        <li key={reason.metric}>
          {t(`desk.case.metric.${reason.metric}`)}: {reason.value === null ? t("desk.case.notRecorded") : reason.value}
        </li>
      ))}
    </ul>
  );
}

// Closing the file (K3, D13, D14): the keepers say the event ended and seal its state; BNPB accepts the
// closing, or opens the file again with its reason (Q2). Each sealed version is listed.
export function CaseClosing({ view, envelope }: { readonly view: CaseView; readonly envelope: ErrorEnvelope | null }) {
  const t = useText();
  const navigation = useNavigation();
  const busy = (intent: string) => (navigation.formData?.get("intent") === intent ? t("desk.case.saving") : null);
  const { status } = view.file;
  const keeper = view.access === "lead" && status === "open";
  const bnpb = view.access === "bnpb";
  return (
    <section aria-labelledby="case-closing" className="flex flex-col gap-3 card-surface p-4 md:p-5">
      <h2 id="case-closing" className="text-card font-bold">
        {t(status === "open" ? "desk.case.close.ask" : `desk.case.status.${status}`)}
      </h2>
      {keeper ? (
        <>
          <p className="text-meta text-muted">{t(`desk.case.close.preview.${view.final.status}`)}</p>
          {view.final.reasons.length > 0 ? <Reasons final={view.final} /> : null}
          <Form method="post" preventScrollReset className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="intent" value="close" />
            <input type="hidden" name="revision" value={view.file.revision} />
            <Field id="endedOn" label={t("desk.case.close.endedOn")} problem={problemOf(envelope, "endedOn")}>
              {(control) => <Input {...control} type="date" defaultValue={view.day} max={view.day} />}
            </Field>
            <Field
              id="note"
              label={t("desk.case.close.note")}
              problem={problemOf(envelope, "note")}
              className="flex min-w-0 flex-col gap-1.5 sm:col-span-2"
            >
              {(control) => <Textarea {...control} maxLength={500} />}
            </Field>
            <div className="sm:col-span-2">
              <Button variant="primary" busyLabel={busy("close")}>
                {t("desk.case.close.button")}
              </Button>
            </div>
          </Form>
        </>
      ) : null}
      {status === "open" && !keeper ? <p className="text-muted">{t("desk.case.close.byKeeper")}</p> : null}
      {bnpb && status === "proposed" ? (
        <Form method="post" replace preventScrollReset>
          <input type="hidden" name="intent" value="accept" />
          <Button variant="primary" busyLabel={busy("accept")}>
            {t("desk.case.accept")}
          </Button>
        </Form>
      ) : null}
      {bnpb && status !== "open" ? (
        <Form method="post" preventScrollReset className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="intent" value="reopen" />
          <Field id="reason" label={t("desk.case.reopen.reason")} problem={problemOf(envelope, "reason")}>
            {(control) => <Input {...control} maxLength={300} />}
          </Field>
          <Button variant="secondary" busyLabel={busy("reopen")}>
            {t("desk.case.reopen")}
          </Button>
        </Form>
      ) : null}
      {view.versions.length > 0 ? (
        <ol className="flex flex-col gap-2" aria-label={t("desk.case.versions")}>
          {view.versions.map((version) => (
            <li key={version.version} className="flex flex-col gap-1 rounded-control bg-sunken p-3">
              <p className="font-semibold">
                {t("desk.case.version", {
                  version: version.version,
                  status: `desk.case.status.${version.final.status}`,
                  endedOn: version.closing.endedOn,
                })}
              </p>
              <p className="text-meta text-muted">
                {t("desk.case.version.by", { by: version.by, when: when(t, "desk.history.at", version.at) })}
              </p>
              {version.final.reasons.length > 0 ? <Reasons final={version.final} /> : null}
              {version.closing.note === null ? null : <p className="text-meta">{version.closing.note}</p>}
              <p className="break-all font-mono text-[0.75rem] text-muted">{version.fingerprint}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
