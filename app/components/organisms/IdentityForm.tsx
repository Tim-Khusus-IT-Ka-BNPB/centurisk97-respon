import { useEffect, useState } from "react";
import { Form } from "react-router";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import { cardProblem, errorIdOf, firstInvalid, isLimit, problemOf } from "../../lib/envelope";
import { useBusy, useFocusOnChange } from "../../lib/hooks";
import type { IdentityValues } from "../../lib/startTypes";
import { limitText } from "../../lib/status";
import { useText } from "../../lib/text";
import { Button } from "../atoms/Button";
import { Input, PrefixedInput } from "../atoms/controls";
import { Icon } from "../atoms/Icon";
import { TileCheck } from "../molecules/ChoiceTile";
import { Field, FieldError } from "../molecules/Field";
import { ActionRow } from "../molecules/layout";
import { Notice } from "../molecules/Notice";
import { Panel } from "../molecules/Panel";
import { SigapSays } from "../molecules/Sigap";
import { PrivacyText } from "./PrivacyText";

const ORDER = ["role", "name", "number", "officerRegency", "officerPosition"] as const;
const PREFIX_ID = "number-prefix";

// The values typed so far, carried through the render-only steps (read-back, decline) unchanged.
export function HiddenValues({
  values,
  withNumber,
  profileId,
  editing,
}: {
  readonly values: IdentityValues;
  readonly withNumber: boolean;
  readonly profileId: string | null;
  readonly editing: boolean;
}) {
  return (
    <>
      {ORDER.filter((name) => withNumber || name !== "number").map((name) => (
        <input key={name} type="hidden" name={name} value={values[name]} />
      ))}
      {profileId ? <input type="hidden" name="profileId" value={profileId} /> : null}
      {editing ? <input type="hidden" name="editProfile" value="1" /> : null}
    </>
  );
}

// Closing the privacy text from inside it needs script; with none, its summary closes it.
function ClosePrivacy() {
  const t = useText();
  const [scripted, setScripted] = useState(false);
  useEffect(() => setScripted(true), []);
  if (!scripted) return null;
  return (
    <Button
      type="button"
      onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
      className="self-start"
    >
      {t("consent.privacyClose")}
    </Button>
  );
}

type FormProps = {
  readonly values: IdentityValues;
  readonly envelope: ErrorEnvelope | null;
  // A main-site session already knows the number; changing a known profile keeps its number.
  readonly askNumber: boolean;
  readonly profileId: string | null;
  readonly editing: boolean;
  readonly unreadable: boolean;
  // Back from the read-back by "Ganti": the number is what is being changed.
  readonly focusNumber: boolean;
};

// Identity and consent as one form. Officer fields show by CSS when "Petugas BPBD" is checked.
export function IdentityForm({ values, envelope, askNumber, profileId, editing, unreadable, focusNumber }: FormProps) {
  const t = useText();
  const focus = firstInvalid(envelope, ORDER) ?? (focusNumber && askNumber ? "number" : null);
  const problem = envelope !== null && isLimit(envelope) ? null : cardProblem(envelope);
  const limit = envelope !== null && isLimit(envelope) ? limitText(t, envelope, Date.now()) : null;
  const agree = editing ? "useProfile" : askNumber ? "readBack" : "consent";
  const busy = useBusy(agree, "action");
  useFocusOnChange(focus, envelope);
  // The officer's fields keep a hint with an example; name and number show theirs inside the box and
  // say a rule only when it is broken.
  const field = (name: (typeof ORDER)[number], autoComplete: string) => (
    <Field
      id={name}
      label={t(`identity.${name}.label`)}
      hint={name === "officerRegency" || name === "officerPosition" ? t(`identity.${name}.hint`) : null}
      problem={problemOf(envelope, name)}
      focus={focus === name}
    >
      {(control) =>
        name === "number" ? (
          <PrefixedInput
            {...control}
            aria-describedby={[PREFIX_ID, control["aria-describedby"]].filter(Boolean).join(" ")}
            prefix={t("identity.number.prefix")}
            prefixId={PREFIX_ID}
            type="tel"
            inputMode="tel"
            autoComplete={autoComplete}
            placeholder={t("identity.number.placeholder")}
            defaultValue={values[name]}
            aria-required
          />
        ) : (
          <Input
            {...control}
            autoComplete={autoComplete}
            placeholder={name === "name" ? t("identity.name.placeholder") : undefined}
            defaultValue={values[name]}
            aria-required
          />
        )
      }
    </Field>
  );
  const refusedRole = problemOf(envelope, "role");
  // One of two, so it is told what to pick rather than what to fill in.
  const roleProblem =
    refusedRole?.copyKey === "fieldError.required" ? { copyKey: "identity.role.required", params: {} } : refusedRole;
  return (
    <>
      {editing ? null : <SigapSays scene="greet" title={t("sigap.start.title")} text={t("sigap.start.text")} />}
      <Panel id="identity-heading" title={t("identity.title")} focusHeading={focus === null}>
        {unreadable ? <Notice kind="info">{t("start.error.knownUnreadable")}</Notice> : null}
        {problem ? <Notice kind="error">{t(problem.copyKey, problem.params)}</Notice> : null}
        {limit ? <Notice kind="limit">{limit}</Notice> : null}
        <Form method="post" className="flex min-w-0 flex-col gap-5">
          {profileId ? <input type="hidden" name="profileId" value={profileId} /> : null}
          {editing ? <input type="hidden" name="editProfile" value="1" /> : null}
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-2 text-body font-semibold">{t("identity.role.label")}</legend>
            <div className="grid gap-2 @tiles:grid-cols-2">
              {(["citizen", "claimedOfficer"] as const).map((role, index) => (
                <TileCheck
                  key={role}
                  id={index === 0 ? "role" : `role-${role}`}
                  type="radio"
                  name="role"
                  value={role}
                  checked={values.role === role}
                  autoFocus={focus === "role" && index === 0}
                  describedBy={roleProblem ? errorIdOf("role") : undefined}
                  label={t(role === "citizen" ? "identity.role.citizen" : "identity.role.officer")}
                  icon={role === "citizen" ? "house" : "clipboardCheck"}
                />
              ))}
            </div>
            <FieldError id="role" problem={roleProblem} />
          </fieldset>
          {field("name", "name")}
          {askNumber ? (
            field("number", "tel-national")
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-body font-semibold">{t("identity.number.label")}</p>
              <p className="flex items-center gap-2 rounded-control bg-sunken px-4 py-3">
                <Icon name="circleCheck" className="text-primary" />
                {t("identity.number.session")}
              </p>
            </div>
          )}
          <div className="reveal-officer flex-col gap-5">
            {field("officerRegency", "off")}
            {field("officerPosition", "organization-title")}
          </div>
          <div className="flex flex-col gap-1 rounded-control border border-line bg-sunken p-2">
            <p className="flex gap-3 px-2 pt-2 text-meta">
              <Icon name="info" className="size-5 shrink-0 text-primary" />
              {t("consent.text")}
            </p>
            <details className="group">
              <summary className="flex min-h-target cursor-pointer list-none items-center gap-1.5 rounded-control px-2 ps-10 font-semibold text-primary hover:underline [&::-webkit-details-marker]:hidden">
                {t("consent.privacyOpen")}
                <Icon name="chevronRight" className="size-4 rotate-90 group-open:-rotate-90" />
              </summary>
              <div className="mt-1 flex flex-col gap-4 border-t border-line px-2 pt-4 pb-2">
                <PrivacyText headingLevel={3} />
                <ClosePrivacy />
              </div>
            </details>
          </div>
          <ActionRow>
            {editing ? null : (
              <Button name="action" value="decline" size="main" className="@actions:px-6">
                {t("consent.decline")}
              </Button>
            )}
            <Button
              name="action"
              value={agree}
              variant="primary"
              size="main"
              className="@actions:flex-1"
              busyLabel={busy ? t("common.saving") : null}
            >
              {t("consent.agree")}
            </Button>
          </ActionRow>
        </Form>
      </Panel>
    </>
  );
}
