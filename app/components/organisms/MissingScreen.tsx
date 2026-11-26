import type { ReactNode } from "react";
import { Form, Link } from "react-router";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import { RELATIONS, SEXES } from "../../../src/domain/missingPerson";
import { cn } from "../../lib/cn";
import { problemOf } from "../../lib/envelope";
import type { MissingLoad, MissingVillage } from "../../lib/missingTypes";
import { useText } from "../../lib/text";
import { Button, buttonStyles } from "../atoms/Button";
import { Input, Textarea } from "../atoms/controls";
import { Icon } from "../atoms/Icon";
import { CallRow } from "../molecules/CallRow";
import { Field, FieldError } from "../molecules/Field";
import { Notice } from "../molecules/Notice";

type FormLoad = Extract<MissingLoad, { kind: "form" }>;
type Typed = Readonly<Record<string, string>>;

// A choice drawn as a tile: the whole tile takes the tap, and the picked one is marked by more than colour.
const tile =
  "flex min-h-target items-center gap-3 rounded-control border border-line bg-surface px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-selected has-[:checked]:font-semibold";

function Choices({
  name,
  options,
  typed,
  envelope,
  className,
}: {
  readonly name: "relation" | "sex";
  readonly options: readonly string[];
  readonly typed: Typed;
  readonly envelope: ErrorEnvelope | null;
  readonly className: string;
}) {
  const t = useText();
  const problem = problemOf(envelope, name);
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={problem ? `${name}-error` : undefined}>
      <legend className="mb-2 font-semibold">{t(`missing.field.${name}`)}</legend>
      <div className={className}>
        {options.map((option) => (
          <label key={option} className={tile}>
            <input
              type="radio"
              name={name}
              value={option}
              defaultChecked={typed[name] === option}
              className="size-5 shrink-0"
            />
            {t(`missing.${name}.${option}`)}
          </label>
        ))}
      </div>
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
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-semibold">{t("missing.place.pick")}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {villages.map((village) => (
          <label key={village.code} className={tile}>
            <input
              type="radio"
              name="villageCode"
              value={village.code}
              required
              defaultChecked={typed.villageCode === village.code || villages.length === 1}
              className="size-5 shrink-0"
            />
            <span className="min-w-0">
              {t("missing.place.option", {
                village: village.name,
                district: village.districtName,
                regency: village.regencyName,
              })}
            </span>
          </label>
        ))}
      </div>
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
  inputClassName,
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
  readonly inputClassName?: string;
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
            className={inputClassName}
          />
        )
      }
    </Field>
  );
}

// One part of the form under its own heading, set off from the part before it.
function Part({ id, title, children }: { readonly id: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5 border-t border-line p-4 md:p-6">
      <h2 id={id} className="text-card font-bold">
        {title}
      </h2>
      {children}
    </section>
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

// Beside the form on a wide screen: what happens once it is sent, and who to call meanwhile.
export function MissingAside() {
  const t = useText();
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="missing-after" className="flex flex-col gap-3 card-surface p-5">
        <h2 id="missing-after" className="text-meta font-semibold text-muted">
          {t("missing.aside.title")}
        </h2>
        <ol className="flex flex-col gap-3">
          {[1, 2, 3].map((step) => (
            <li key={step} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line text-meta font-bold tabular-nums"
              >
                {step}
              </span>
              <span>{t(`missing.aside.step${step}`)}</span>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="missing-call" className="flex flex-col gap-2">
        <h2 id="missing-call" className="text-meta font-semibold text-muted">
          {t("card.sent.numbers.title")}
        </h2>
        {(["112", "115", "117"] as const).map((number) => (
          <CallRow key={number} number={number} label={t(`card.sent.numbers.${number}`)} first={number === "112"} />
        ))}
      </section>
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
      <p className="max-w-[60ch]">{t("missing.whoFirst.body")}</p>
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
          <p className="max-w-[60ch]">{t("missing.sent.body")}</p>
        </section>
      ) : null}
      {load.mine.length > 0 ? (
        <section aria-labelledby="missing-mine" className="flex flex-col gap-2">
          <h2 id="missing-mine" className="text-card font-bold">
            {t("missing.mine.title")}
          </h2>
          <ul className="flex flex-col overflow-hidden card-surface">
            {load.mine.map((one) => (
              <li
                key={one.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-3 first:border-t-0"
              >
                <span className="min-w-0">
                  {t("missing.mine.item", { name: one.name ?? t("missing.anonymous"), village: one.villageName })}
                </span>
                <span
                  className={cn(
                    "rounded-control px-2 py-0.5 text-meta font-semibold",
                    one.status === "open" ? "bg-warn-tint" : "bg-sunken",
                  )}
                >
                  {t(`missing.status.${one.status}`)}
                </span>
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
          className="flex flex-col overflow-hidden card-surface"
          aria-label={t("missing.title")}
          noValidate
        >
          <div className="flex flex-col gap-4 p-4 md:p-6">
            {general ? <Notice kind="error">{t(general.error.copyKey, general.error.params)}</Notice> : null}
            <VillageChoice villages={load.search.villages} typed={typed} envelope={envelope} />
          </div>
          <Part id="missing-person" title={t("missing.person.title")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="name" typed={typed} envelope={envelope} />
              <TextField name="nickname" typed={typed} envelope={envelope} optional />
            </div>
            <Choices
              name="relation"
              options={RELATIONS}
              typed={typed}
              envelope={envelope}
              className="grid grid-cols-2 gap-2 md:grid-cols-3"
            />
            <div className="grid items-start gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Choices
                name="sex"
                options={SEXES}
                typed={typed}
                envelope={envelope}
                className="grid grid-cols-2 gap-2 sm:grid-cols-3"
              />
              <TextField
                name="age"
                typed={typed}
                envelope={envelope}
                inputMode="numeric"
                unitKey="missing.field.ageUnit"
                inputClassName="sm:w-40"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="clothes" typed={typed} envelope={envelope} optional hint long />
              <TextField name="marks" typed={typed} envelope={envelope} optional hint long />
            </div>
            <Field
              id="photo"
              label={t("missing.field.photo")}
              unit={t("missing.optional")}
              hint={t("missing.field.photoHint")}
              problem={problemOf(envelope, "photo")}
            >
              {(control) => (
                <input
                  {...control}
                  type="file"
                  accept="image/jpeg"
                  className="min-h-target w-full min-w-0 rounded-control border border-dashed border-control bg-surface p-2 text-meta file:me-3 file:min-h-target-min file:rounded-control file:border-0 file:bg-sunken file:px-3 file:font-semibold file:text-ink"
                />
              )}
            </Field>
          </Part>
          <Part id="missing-when" title={t("missing.lastSeen.title")}>
            <div className="grid grid-cols-2 gap-4 sm:max-w-md">
              <TextField name="lastSeenDate" typed={typed} envelope={envelope} type="date" />
              <TextField name="lastSeenTime" typed={typed} envelope={envelope} type="time" optional />
            </div>
          </Part>
          <Part id="missing-contact" title={t("missing.contact.title")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                name="contactNumber"
                typed={typed}
                envelope={envelope}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                hint
              />
              <TextField
                name="personNumber"
                typed={typed}
                envelope={envelope}
                type="tel"
                inputMode="tel"
                optional
                hint
              />
            </div>
            <TextField name="waitPlace" typed={typed} envelope={envelope} hint long />
          </Part>
          <div className="flex flex-col gap-4 border-t border-line bg-sunken p-4 md:flex-row md:items-center md:justify-between md:p-6">
            <p className="max-w-[52ch] text-meta text-muted">{t("missing.privacy")}</p>
            <Button type="submit" variant="primary" size="main" className="shrink-0">
              <Icon name="send" className="size-5" />
              {t("missing.submit")}
            </Button>
          </div>
        </Form>
      ) : null}
    </>
  );
}
