import { Form, Link } from "react-router";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import { RELATIONS, SEXES } from "../../../src/domain/missingPerson";
import { problemOf } from "../../lib/envelope";
import type { MissingLoad, MissingVillage } from "../../lib/missingTypes";
import { useText } from "../../lib/text";
import { Button, buttonStyles } from "../atoms/Button";
import { Input, Textarea } from "../atoms/controls";
import { Icon } from "../atoms/Icon";
import { Field, FieldError } from "../molecules/Field";
import { Notice } from "../molecules/Notice";

type FormLoad = Extract<MissingLoad, { kind: "form" }>;
type Typed = Readonly<Record<string, string>>;

function Choices({
  name,
  options,
  typed,
  envelope,
}: {
  readonly name: "relation" | "sex";
  readonly options: readonly string[];
  readonly typed: Typed;
  readonly envelope: ErrorEnvelope | null;
}) {
  const t = useText();
  const problem = problemOf(envelope, name);
  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={problem ? `${name}-error` : undefined}>
      <legend className="mb-1.5 font-semibold">{t(`missing.field.${name}`)}</legend>
      {options.map((option) => (
        <label key={option} className="flex min-h-target-min items-center gap-3">
          <input type="radio" name={name} value={option} defaultChecked={typed[name] === option} className="size-5" />
          {t(`missing.${name}.${option}`)}
        </label>
      ))}
      <FieldError id={name} problem={problem} />
    </fieldset>
  );
}

function VillageChoice({
  villages,
  typed,
  envelope,
}: {
  readonly villages: readonly MissingVillage[];
  readonly typed: Typed;
  readonly envelope: ErrorEnvelope | null;
}) {
  const t = useText();
  const problem = problemOf(envelope, "villageCode");
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 font-semibold">{t("missing.place.pick")}</legend>
      {villages.map((village) => (
        <label key={village.code} className="flex min-h-target-min items-center gap-3">
          <input
            type="radio"
            name="villageCode"
            value={village.code}
            required
            defaultChecked={typed.villageCode === village.code || villages.length === 1}
            className="size-5 shrink-0"
          />
          {t("missing.place.option", {
            village: village.name,
            district: village.districtName,
            regency: village.regencyName,
          })}
        </label>
      ))}
      <FieldError id="villageCode" problem={problem} />
    </fieldset>
  );
}

function TextField({
  name,
  typed,
  envelope,
  optional = false,
  hint = false,
  long = false,
  type = "text",
  inputMode,
  autoComplete = "off",
  unitKey,
}: {
  readonly name: string;
  readonly typed: Typed;
  readonly envelope: ErrorEnvelope | null;
  readonly optional?: boolean;
  readonly hint?: boolean;
  readonly long?: boolean;
  readonly type?: string;
  readonly inputMode?: "numeric" | "tel";
  readonly autoComplete?: string;
  readonly unitKey?: string;
}) {
  const t = useText();
  return (
    <Field
      id={name}
      label={t(`missing.field.${name}`)}
      unit={unitKey ? t(unitKey) : optional ? t("missing.optional") : null}
      hint={hint ? t(`missing.field.${name}Hint`) : undefined}
      problem={problemOf(envelope, name)}
    >
      {(control) =>
        long ? (
          <Textarea {...control} defaultValue={typed[name] ?? ""} maxLength={300} />
        ) : (
          <Input
            {...control}
            type={type}
            inputMode={inputMode}
            autoComplete={autoComplete}
            defaultValue={typed[name] ?? ""}
            maxLength={120}
          />
        )
      }
    </Field>
  );
}

// The report of a missing person (K105): a village found, then who is missing, when they were last
// seen, and how to reach the one who reports. Server forms, so it works with no script.
export function MissingScreen({
  load,
  envelope,
  typed = {},
}: {
  readonly load: MissingLoad;
  readonly envelope: ErrorEnvelope | null;
  readonly typed?: Typed;
}) {
  const t = useText();
  return (
    <div className="flex flex-col gap-6">
      <Notice kind="danger">{t("missing.urgent")}</Notice>
      {load.kind === "whoFirst" ? <WhoFirst /> : <Report load={load} envelope={envelope} typed={typed} />}
    </div>
  );
}

function WhoFirst() {
  const t = useText();
  return (
    <section aria-labelledby="missing-who" className="flex flex-col gap-3 card-surface p-4 md:p-6">
      <h2 id="missing-who" className="text-card font-bold">
        {t("missing.whoFirst.title")}
      </h2>
      <p>{t("missing.whoFirst.body")}</p>
      <Link to="/lapor/report?hilang=1" className={buttonStyles({ variant: "primary", className: "self-start" })}>
        {t("missing.whoFirst.go")}
      </Link>
    </section>
  );
}

function Report({
  load,
  envelope,
  typed,
}: {
  readonly load: FormLoad;
  readonly envelope: ErrorEnvelope | null;
  readonly typed: Typed;
}) {
  const t = useText();
  const general = envelope !== null && envelope.fields.length === 0 ? envelope : null;
  return (
    <>
      {load.sent ? (
        <section aria-labelledby="missing-sent" className="flex flex-col gap-2 card-surface p-4 md:p-6" role="status">
          <h2 id="missing-sent" className="flex items-center gap-2 text-card font-bold">
            <Icon name="circleCheck" className="size-6 text-primary" />
            {t("missing.sent.title")}
          </h2>
          <p>{t("missing.sent.body")}</p>
        </section>
      ) : null}
      {load.mine.length > 0 ? (
        <section aria-labelledby="missing-mine" className="flex flex-col gap-2">
          <h2 id="missing-mine" className="text-card font-bold">
            {t("missing.mine.title")}
          </h2>
          <ul className="flex flex-col gap-2">
            {load.mine.map((one) => (
              <li key={one.id} className="flex flex-wrap items-center justify-between gap-2 card-surface px-4 py-3">
                <span>
                  {t("missing.mine.item", { name: one.name ?? t("missing.anonymous"), village: one.villageName })}
                </span>
                <span className="font-semibold">{t(`missing.status.${one.status}`)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="missing-place" className="flex flex-col gap-3 card-surface p-4 md:p-6">
        <h2 id="missing-place" className="text-card font-bold">
          {t("missing.place.title")}
        </h2>
        <Form method="get" action="/lapor/orang-hilang" className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5">
            <label htmlFor="missing-q" className="font-semibold">
              {t("missing.place.label")}
            </label>
            <p id="missing-q-hint" className="text-meta text-muted">
              {t("missing.place.hint")}
            </p>
            <Input
              id="missing-q"
              name="q"
              type="search"
              aria-describedby="missing-q-hint"
              defaultValue={load.query}
              minLength={3}
              maxLength={60}
            />
          </div>
          <Button variant="secondary">
            <Icon name="search" className="size-5" />
            {t("missing.place.submit")}
          </Button>
        </Form>
        {load.search.kind === "short" ? <p className="text-meta text-danger">{t("missing.place.short")}</p> : null}
        {load.search.kind === "none" ? <p className="text-meta text-muted">{t("missing.place.none")}</p> : null}
        {load.search.kind === "unavailable" ? <Notice kind="error">{t("missing.place.unavailable")}</Notice> : null}
      </section>
      {load.search.kind === "results" ? (
        <Form
          method="post"
          encType="multipart/form-data"
          className="flex flex-col gap-6 card-surface p-4 md:p-6"
          aria-labelledby="missing-person"
          noValidate
        >
          {general ? <Notice kind="error">{t(general.error.copyKey, general.error.params)}</Notice> : null}
          <VillageChoice villages={load.search.villages} typed={typed} envelope={envelope} />
          <h2 id="missing-person" className="text-card font-bold">
            {t("missing.person.title")}
          </h2>
          <TextField name="name" typed={typed} envelope={envelope} />
          <TextField name="nickname" typed={typed} envelope={envelope} optional />
          <Choices name="relation" options={RELATIONS} typed={typed} envelope={envelope} />
          <Choices name="sex" options={SEXES} typed={typed} envelope={envelope} />
          <TextField name="age" typed={typed} envelope={envelope} inputMode="numeric" unitKey="missing.field.ageUnit" />
          <TextField name="clothes" typed={typed} envelope={envelope} optional hint long />
          <TextField name="marks" typed={typed} envelope={envelope} optional hint long />
          <div className="flex flex-wrap gap-4">
            <TextField name="lastSeenDate" typed={typed} envelope={envelope} type="date" />
            <TextField name="lastSeenTime" typed={typed} envelope={envelope} type="time" optional />
          </div>
          <TextField name="personNumber" typed={typed} envelope={envelope} type="tel" optional hint />
          <Field
            id="photo"
            label={t("missing.field.photo")}
            unit={t("missing.optional")}
            hint={t("missing.field.photoHint")}
            problem={problemOf(envelope, "photo")}
          >
            {(control) => <input {...control} type="file" accept="image/jpeg" className="min-h-target" />}
          </Field>
          <h2 className="text-card font-bold">{t("missing.contact.title")}</h2>
          <TextField
            name="contactNumber"
            typed={typed}
            envelope={envelope}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
          />
          <TextField name="waitPlace" typed={typed} envelope={envelope} hint long />
          <p className="text-meta text-muted">{t("missing.privacy")}</p>
          <Button type="submit" variant="primary" size="main" className="self-start">
            <Icon name="send" className="size-5" />
            {t("missing.submit")}
          </Button>
        </Form>
      ) : null}
    </>
  );
}
