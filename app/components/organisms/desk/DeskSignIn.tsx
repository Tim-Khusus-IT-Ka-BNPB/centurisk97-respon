import { Form, Link, useNavigation } from "react-router";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { problemOf } from "../../../lib/envelope";
import { useFocusOnChange } from "../../../lib/hooks";
import { limitText } from "../../../lib/status";
import { useText } from "../../../lib/text";
import { Button, buttonStyles } from "../../atoms/Button";
import { Input } from "../../atoms/controls";
import { Field } from "../../molecules/Field";
import { Notice } from "../../molecules/Notice";
import { Panel } from "../../molecules/Panel";

export function DeskSignIn({ envelope }: { readonly envelope: ErrorEnvelope | null }) {
  const t = useText();
  const busy = useNavigation().state === "submitting";
  const problem = problemOf(envelope, "code");
  useFocusOnChange(problem === null ? null : "code", envelope);
  return (
    <div className="mx-auto w-full max-w-[28rem] md:pt-10">
      <Panel
        id="desk-sign-in"
        level={1}
        title={t("desk.signIn.title")}
        lead={t("desk.signIn.lead")}
        focusHeading={problem === null}
      >
        {envelope !== null && problem === null ? (
          <Notice kind={envelope.error.code.startsWith("limit.") ? "limit" : "error"}>
            <p>{limitText(t, envelope, Date.now())}</p>
          </Notice>
        ) : null}
        <Form method="post" action="/desk" className="flex flex-col gap-4">
          <input type="hidden" name="action" value="signIn" />
          <Field
            id="code"
            label={t("desk.signIn.code")}
            hint={t("desk.signIn.codeHint")}
            problem={problem}
            focus={problem !== null}
          >
            {(control) => <Input {...control} type="password" autoComplete="off" required />}
          </Field>
          <Button variant="primary" size="main" busyLabel={busy ? t("desk.signIn.busy") : null}>
            {t("desk.signIn.submit")}
          </Button>
        </Form>
      </Panel>
    </div>
  );
}

// A refused read: what the envelope says, and the way back to the list.
export function DeskRefused({ envelope }: { readonly envelope: ErrorEnvelope }) {
  const t = useText();
  const missing = envelope.error.code === "desk.reportNotFound";
  return (
    <div className="mx-auto w-full max-w-[32rem] md:pt-10">
      <Panel id="desk-refused" level={1} title={t(missing ? "desk.refused.missing" : "desk.refused.title")}>
        <Notice kind={envelope.error.code.startsWith("limit.") ? "limit" : "error"}>
          <p>{limitText(t, envelope, Date.now())}</p>
        </Notice>
        <Link to="/desk" className={buttonStyles({ variant: "primary", size: "main" })}>
          {t("desk.refused.back")}
        </Link>
      </Panel>
    </div>
  );
}
