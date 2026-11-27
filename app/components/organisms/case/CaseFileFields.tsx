import { Form, useNavigation } from "react-router";
import type { CaseView } from "../../../../src/contract/cases";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { problemOf } from "../../../lib/envelope";
import { useText } from "../../../lib/text";
import { Button } from "../../atoms/Button";
import { Input, Select, Textarea } from "../../atoms/controls";
import { Field } from "../../molecules/Field";

const STATUSES = ["alert", "emergencyResponse", "transition", "notSet"] as const;

// The file's own values (F-9): its emergency status, decree, post, efforts and personnel. Kept by its
// regency's BPBD; read by the others.
export function CaseFileFields({
  view,
  envelope,
}: {
  readonly view: CaseView;
  readonly envelope: ErrorEnvelope | null;
}) {
  const t = useText();
  const navigation = useNavigation();
  const fields = view.file.fields;
  const post = (fields.post ?? {}) as { readonly name?: string; readonly phone?: string };
  const value = (id: string) => (fields[id] === undefined ? "" : String(fields[id]));
  const disabled = view.access !== "lead" || view.file.status !== "open";
  const field = (id: string) => ({ id, label: t(`desk.case.fields.${id}`), problem: problemOf(envelope, id) });
  return (
    <section aria-labelledby="case-fields" className="flex flex-col gap-3 card-surface p-4 md:p-5">
      <h2 id="case-fields" className="text-card font-bold">
        {t("desk.case.fields")}
      </h2>
      <Form method="post" preventScrollReset className="grid gap-3 md:grid-cols-2">
        <input type="hidden" name="intent" value="fields" />
        <input type="hidden" name="revision" value={view.file.revision} />
        <fieldset disabled={disabled} className="contents">
          <Field {...field("emergencyStatus")}>
            {(control) => (
              <Select {...control} defaultValue={value("emergencyStatus")}>
                <option value="">{t("desk.case.choose")}</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`desk.case.emergency.${status}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field {...field("personnel")}>
            {(control) => <Input {...control} inputMode="numeric" defaultValue={value("personnel")} />}
          </Field>
          <Field {...field("decreeNumber")}>
            {(control) => <Input {...control} defaultValue={value("decreeNumber")} />}
          </Field>
          <Field {...field("decreeDate")}>
            {(control) => <Input {...control} type="date" defaultValue={value("decreeDate")} />}
          </Field>
          <Field {...{ ...field("postName"), problem: problemOf(envelope, "post") }}>
            {(control) => <Input {...control} defaultValue={post.name ?? ""} />}
          </Field>
          <Field {...field("postPhone")}>
            {(control) => <Input {...control} inputMode="tel" defaultValue={post.phone ?? ""} />}
          </Field>
          <Field {...field("efforts")} className="flex min-w-0 flex-col gap-1.5 md:col-span-2">
            {(control) => <Textarea {...control} defaultValue={value("efforts")} maxLength={500} />}
          </Field>
          {disabled ? null : (
            <div className="md:col-span-2">
              <Button
                variant="primary"
                busyLabel={navigation.formData?.get("intent") === "fields" ? t("desk.case.saving") : null}
              >
                {t("desk.case.save")}
              </Button>
            </div>
          )}
        </fieldset>
      </Form>
    </section>
  );
}
