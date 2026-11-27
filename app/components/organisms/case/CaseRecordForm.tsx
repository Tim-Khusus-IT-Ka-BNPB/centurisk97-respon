import { Form, Link, useNavigation } from "react-router";
import type { CaseView } from "../../../../src/contract/cases";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { CASE_SPEC, type CaseField, type CaseKind } from "../../../../src/domain/caseSpec";
import { problemOf } from "../../../lib/envelope";
import { useText } from "../../../lib/text";
import { Button, buttonStyles } from "../../atoms/Button";
import { Input, Select, Textarea } from "../../atoms/controls";
import { Field } from "../../molecules/Field";
import { recordName } from "./recordName";

type CaseRecord = CaseView["records"][number];
type Typed = Readonly<Record<string, string>>;

// A value as the form shows it: a yes or no as its option, anything else as text.
const shown = (value: unknown) =>
  value === true ? "yes" : value === false ? "no" : value === undefined ? "" : String(value);

function Control({
  kind,
  one,
  control,
  value,
  records,
}: {
  readonly kind: CaseKind;
  readonly one: CaseField;
  readonly control: Parameters<Parameters<typeof Field>[0]["children"]>[0];
  readonly value: string;
  readonly records: readonly CaseRecord[];
}) {
  const t = useText();
  const { field } = one;
  if (field.type === "choice" || field.type === "yesNo") {
    const values = field.type === "yesNo" ? ["yes", "no"] : field.values;
    return (
      <Select {...control} defaultValue={value}>
        <option value="">{t("desk.case.choose")}</option>
        {values.map((choice) => (
          <option key={choice} value={choice}>
            {t(`desk.case.choice.${choice}`)}
          </option>
        ))}
      </Select>
    );
  }
  if (field.type === "record") {
    // An evacuee's or a need's shelter: the only records a record points to.
    const options = records.filter((record) => record.kind === "shelter" && record.cancelledReason === null);
    return (
      <Select {...control} defaultValue={value}>
        <option value="">{t(kind === "need" ? "desk.case.noShelter" : "desk.case.choose")}</option>
        {options.map((record) => (
          <option key={record.id} value={record.id}>
            {recordName(t, record)}
          </option>
        ))}
      </Select>
    );
  }
  if (one.id === "head") {
    const heads = records.filter((record) => record.kind === "evacuee" && record.cancelledReason === null);
    return (
      <Select {...control} defaultValue={value}>
        <option value="self">{t("desk.case.headSelf")}</option>
        {heads.map((record) => (
          <option key={record.id} value={record.id}>
            {recordName(t, record)}
          </option>
        ))}
      </Select>
    );
  }
  if (field.type === "text" && field.max > 200)
    return <Textarea {...control} defaultValue={value} maxLength={field.max} />;
  const type = field.type === "date" ? "date" : "text";
  const inputMode =
    field.type === "number" ? "decimal" : field.type === "phone" ? "tel" : field.type === "nik" ? "numeric" : undefined;
  return <Input {...control} type={type} inputMode={inputMode} defaultValue={value} />;
}

function Many({
  one,
  values,
  problem,
}: {
  readonly one: CaseField & { readonly field: { readonly type: "many"; readonly values: readonly string[] } };
  readonly values: readonly string[];
  readonly problem: boolean;
}) {
  const t = useText();
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" aria-invalid={problem || undefined}>
      <legend className="mb-1 font-semibold">{t(`desk.case.field.evacuee.${one.id}`)}</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {one.field.values.map((choice) => (
          <label key={choice} className="flex min-h-target-min items-center gap-2">
            <input
              type="checkbox"
              name={`v.${one.id}`}
              value={choice}
              defaultChecked={values.includes(choice)}
              className="size-5"
            />
            {t(`desk.case.choice.${choice}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// A record's form, from its kind's spec: a new one, or one being changed from its revision. A
// value refused is named under its own box.
export function CaseRecordForm({
  kind,
  records,
  editing,
  envelope,
  typed,
}: {
  readonly kind: CaseKind;
  readonly records: readonly CaseRecord[];
  readonly editing: CaseRecord | null;
  readonly envelope: ErrorEnvelope | null;
  readonly typed: Typed | null;
}) {
  const t = useText();
  const navigation = useNavigation();
  const busy = navigation.formData?.get("kind") === kind && navigation.formData.get("intent") !== "photo";
  const kept: Readonly<Record<string, unknown>> = editing === null ? {} : { ...editing.data, ...editing.personal };
  const boxValue = (id: string) => (typed === null ? shown(kept[id]) : (typed[`v.${id}`] ?? ""));
  const title =
    editing === null
      ? t("desk.case.add", { kind: `desk.case.kind.${kind}` })
      : t("desk.case.edit", { kind: `desk.case.kind.${kind}`, seq: editing.seq });
  return (
    <section aria-labelledby="case-form" className="flex flex-col gap-4 card-surface p-4 md:p-5">
      <h2 id="case-form" className="text-card font-bold">
        {title}
      </h2>
      <Form method="post" preventScrollReset className="grid gap-4 md:grid-cols-2">
        <input type="hidden" name="intent" value={editing === null ? "record" : "update"} />
        <input type="hidden" name="kind" value={kind} />
        {editing === null ? null : (
          <>
            <input type="hidden" name="recordId" value={editing.id} />
            <input type="hidden" name="revision" value={editing.revision} />
          </>
        )}
        {CASE_SPEC[kind].fields.map((one) =>
          one.field.type === "many" ? (
            <Many
              key={one.id}
              one={one as Parameters<typeof Many>[0]["one"]}
              values={typed === null ? ((kept[one.id] as string[] | undefined) ?? []) : []}
              problem={problemOf(envelope, one.id) !== null}
            />
          ) : (
            <Field
              key={one.id}
              id={`v.${one.id}`}
              label={t(`desk.case.field.${kind}.${one.id}`)}
              problem={problemOf(envelope, one.id)}
            >
              {(control) => (
                <Control kind={kind} one={one} control={control} value={boxValue(one.id)} records={records} />
              )}
            </Field>
          ),
        )}
        {kind === "house" || kind === "infrastructure" || kind === "shelter" || kind === "business" ? (
          <fieldset className="flex flex-col gap-2 md:col-span-2">
            <legend className="font-semibold">{t("desk.case.point")}</legend>
            <p className="text-meta text-muted">{t("desk.case.point.hint")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="lat" label={t("desk.case.point.lat")} problem={null}>
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    defaultValue={typed?.lat ?? (editing?.point?.lat ?? "").toString()}
                  />
                )}
              </Field>
              <Field id="lon" label={t("desk.case.point.lon")} problem={null}>
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    defaultValue={typed?.lon ?? (editing?.point?.lon ?? "").toString()}
                  />
                )}
              </Field>
            </div>
          </fieldset>
        ) : null}
        <div className="flex flex-wrap gap-3 md:col-span-2">
          <Button variant="primary" busyLabel={busy ? t("desk.case.saving") : null}>
            {t("desk.case.save")}
          </Button>
          {editing === null ? null : (
            <Link to={`?kind=${kind}`} className={buttonStyles({ variant: "secondary" })}>
              {t("desk.case.cancelEdit")}
            </Link>
          )}
        </div>
      </Form>
    </section>
  );
}
