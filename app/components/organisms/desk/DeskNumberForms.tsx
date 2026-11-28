import type { ReactNode } from "react";
import { Form, useNavigation } from "react-router";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { FACILITY_KINDS } from "../../../../src/domain/facilities";
import { CONTACT_KINDS } from "../../../../src/domain/numbersEdit";
import type { DeskTyped } from "../../../lib/deskTypes";
import { errorIdOf, firstInvalid, hintIdOf, problemOf } from "../../../lib/envelope";
import { useText } from "../../../lib/text";
import { Button } from "../../atoms/Button";
import { Input, Label, Select } from "../../atoms/controls";
import { Field, FieldError } from "../../molecules/Field";

// A form the server refused comes back with what was typed, named by its key.
export type NumbersRefused = { readonly envelope: ErrorEnvelope; readonly typed: DeskTyped } | null;

// What every form of the page carries: the list, the form's own key, the edit, the file version it
// was read from, and which entry.
export type NumbersFormBase = {
  readonly formKey: string;
  readonly tab: "bpbd" | "facilities";
  readonly checksum: string | null;
  readonly code?: string;
  readonly index?: number;
};

function useBusy(formKey: string) {
  const t = useText();
  return useNavigation().formData?.get("form") === formKey ? t("desk.busy") : null;
}

// The refusal and the typed values, when they are this form's.
function refusalFor(refused: NumbersRefused, formKey: string) {
  return refused !== null && refused.typed.values.form === formKey ? refused : null;
}

function EditForm({
  base,
  edit,
  children,
}: {
  readonly base: NumbersFormBase;
  readonly edit: "add" | "change" | "remove";
  readonly children: ReactNode;
}) {
  return (
    <Form method="post" preventScrollReset className="flex flex-col gap-4">
      <input type="hidden" name="tab" value={base.tab} />
      <input type="hidden" name="form" value={base.formKey} />
      <input type="hidden" name="edit" value={edit} />
      <input type="hidden" name="checksum" value={base.checksum ?? ""} />
      {base.code === undefined ? null : <input type="hidden" name="code" value={base.code} />}
      {base.index === undefined ? null : <input type="hidden" name="index" value={base.index} />}
      {children}
    </Form>
  );
}

type NumberValues = {
  readonly nomor: string;
  readonly jenis: string;
  readonly url: string | null;
  readonly lama: boolean;
};

// One BPBD number, new or as it is: its digits, its kind, the page that names it, and whether it is old.
export function NumberForm({
  base,
  number,
  refused,
  submit,
}: {
  readonly base: NumbersFormBase;
  readonly number: NumberValues | null;
  readonly refused: NumbersRefused;
  readonly submit: string;
}) {
  const t = useText();
  const busyLabel = useBusy(base.formKey);
  const mine = refusalFor(refused, base.formKey);
  const envelope = mine?.envelope ?? null;
  const value = (name: string, kept: string) => (mine === null ? kept : (mine.typed.values[name] ?? ""));
  const focus = firstInvalid(envelope, ["nomor", "jenis", "url"]);
  const id = (name: string) => `${base.formKey}-${name}`;
  return (
    <EditForm base={base} edit={number === null ? "add" : "change"}>
      <Field
        id={id("nomor")}
        label={t("desk.numbers.form.nomor")}
        hint={t("desk.numbers.form.nomorHint")}
        problem={problemOf(envelope, "nomor")}
        focus={focus === "nomor"}
      >
        {(control) => (
          <Input
            {...control}
            name="nomor"
            inputMode="tel"
            autoComplete="off"
            maxLength={60}
            defaultValue={value("nomor", number?.nomor ?? "")}
          />
        )}
      </Field>
      <Field
        id={id("jenis")}
        label={t("desk.numbers.form.jenis")}
        problem={problemOf(envelope, "jenis")}
        focus={focus === "jenis"}
      >
        {(control) => (
          <Select {...control} name="jenis" defaultValue={value("jenis", number?.jenis ?? CONTACT_KINDS[0])}>
            {CONTACT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`desk.numbers.kind.${kind}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        id={id("url")}
        label={t("desk.numbers.form.url")}
        unit={t("desk.numbers.optional")}
        hint={t("desk.numbers.form.urlHint")}
        problem={problemOf(envelope, "url")}
        focus={focus === "url"}
      >
        {(control) => (
          <Input
            {...control}
            name="url"
            inputMode="url"
            autoComplete="off"
            maxLength={400}
            defaultValue={value("url", number?.url ?? "")}
          />
        )}
      </Field>
      <label className="flex min-h-target-min items-center gap-3">
        <input
          type="checkbox"
          name="lama"
          defaultChecked={mine === null ? number?.lama === true : mine.typed.values.lama === "on"}
          className="size-5 shrink-0 accent-primary"
        />
        {t("desk.numbers.form.lama")}
      </label>
      <Button variant="primary" busyLabel={busyLabel} className="self-start">
        {submit}
      </Button>
    </EditForm>
  );
}

type FacilityValues = {
  readonly kind: string;
  readonly name: string;
  readonly phone: string;
  readonly lat: number;
  readonly lon: number;
};

// One facility, new or as it is: its kind, name, number and point.
export function FacilityForm({
  base,
  facility,
  refused,
  submit,
}: {
  readonly base: NumbersFormBase;
  readonly facility: FacilityValues | null;
  readonly refused: NumbersRefused;
  readonly submit: string;
}) {
  const t = useText();
  const busyLabel = useBusy(base.formKey);
  const mine = refusalFor(refused, base.formKey);
  const envelope = mine?.envelope ?? null;
  const value = (name: string, kept: string) => (mine === null ? kept : (mine.typed.values[name] ?? ""));
  const focus = firstInvalid(envelope, ["kind", "name", "phone", "point"]);
  const id = (name: string) => `${base.formKey}-${name}`;
  const point = problemOf(envelope, "point");
  const pointDescribed = [hintIdOf(id("point")), point === null ? null : errorIdOf(id("point"))]
    .filter((one) => one !== null)
    .join(" ");
  return (
    <EditForm base={base} edit={facility === null ? "add" : "change"}>
      <Field
        id={id("kind")}
        label={t("desk.numbers.facility.kind")}
        problem={problemOf(envelope, "kind")}
        focus={focus === "kind"}
      >
        {(control) => (
          <Select {...control} name="kind" defaultValue={value("kind", facility?.kind ?? FACILITY_KINDS[0])}>
            {FACILITY_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`desk.numbers.facility.kind.${kind}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        id={id("name")}
        label={t("desk.numbers.facility.name")}
        problem={problemOf(envelope, "name")}
        focus={focus === "name"}
      >
        {(control) => (
          <Input
            {...control}
            name="name"
            autoComplete="off"
            maxLength={300}
            defaultValue={value("name", facility?.name ?? "")}
          />
        )}
      </Field>
      <Field
        id={id("phone")}
        label={t("desk.numbers.facility.phone")}
        hint={t("desk.numbers.facility.phoneHint")}
        problem={problemOf(envelope, "phone")}
        focus={focus === "phone"}
      >
        {(control) => (
          <Input
            {...control}
            name="phone"
            inputMode="tel"
            autoComplete="off"
            maxLength={60}
            defaultValue={value("phone", facility?.phone ?? "")}
          />
        )}
      </Field>
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="font-semibold">{t("desk.numbers.facility.point")}</legend>
        <p id={hintIdOf(id("point"))} className="text-meta text-muted">
          {t("desk.numbers.facility.pointHint")}
        </p>
        <div className="flex flex-wrap gap-3">
          {(["lat", "lon"] as const).map((axis) => (
            <div key={axis} className="flex min-w-0 flex-1 basis-40 flex-col gap-1.5">
              <Label htmlFor={id(axis)} className="font-normal">
                {t(`desk.numbers.facility.${axis}`)}
              </Label>
              <Input
                id={id(axis)}
                name={axis}
                inputMode="decimal"
                autoComplete="off"
                maxLength={30}
                aria-invalid={point === null ? undefined : true}
                aria-describedby={pointDescribed}
                autoFocus={axis === "lat" && focus === "point"}
                defaultValue={value(axis, facility === null ? "" : String(facility[axis]))}
              />
            </div>
          ))}
        </div>
        <FieldError id={id("point")} problem={point} />
      </fieldset>
      <Button variant="primary" busyLabel={busyLabel} className="self-start">
        {submit}
      </Button>
    </EditForm>
  );
}

// The confirming step before an entry goes: what goes and what it means, then the one button.
export function RemoveForm({
  base,
  question,
  confirm,
}: {
  readonly base: NumbersFormBase;
  readonly question: string;
  readonly confirm: string;
}) {
  const busyLabel = useBusy(base.formKey);
  return (
    <EditForm base={base} edit="remove">
      <p>{question}</p>
      <Button variant="danger" busyLabel={busyLabel} className="self-start">
        {confirm}
      </Button>
    </EditForm>
  );
}
