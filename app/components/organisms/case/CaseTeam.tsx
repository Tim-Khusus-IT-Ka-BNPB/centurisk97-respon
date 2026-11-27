import { Form, useNavigation } from "react-router";
import type { CaseView } from "../../../../src/contract/cases";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { problemOf } from "../../../lib/envelope";
import { useText } from "../../../lib/text";
import { Button } from "../../atoms/Button";
import { Input } from "../../atoms/controls";
import { Field } from "../../molecules/Field";
import { Notice } from "../../molecules/Notice";

// The team of a file (D11): its keepers add members by name and number and send each the one-time
// link shown here once; BNPB may take a member off too.
export function CaseTeam({
  view,
  envelope,
  link,
}: {
  readonly view: CaseView;
  readonly envelope: ErrorEnvelope | null;
  readonly link: { readonly link: string; readonly name: string } | null;
}) {
  const t = useText();
  const navigation = useNavigation();
  const lead = view.access === "lead";
  const busy = (intent: string, memberId?: string) =>
    navigation.formData?.get("intent") === intent &&
    (memberId === undefined || navigation.formData.get("memberId") === memberId);
  return (
    <section aria-labelledby="case-team" className="flex flex-col gap-3 card-surface p-4 md:p-5">
      <div className="flex flex-col gap-1">
        <h2 id="case-team" className="text-card font-bold">
          {t("desk.case.team")}
        </h2>
        <p className="text-meta text-muted">{t("desk.case.team.lead")}</p>
      </div>
      {link === null ? null : (
        <Notice kind="info">
          <p className="font-semibold">{t("desk.case.link", { name: link.name })}</p>
          <p className="break-all font-mono text-meta">{link.link}</p>
          <p className="text-meta">{t("desk.case.link.lead")}</p>
        </Notice>
      )}
      {view.members.length === 0 ? (
        <p className="text-muted">{t("desk.case.team.none")}</p>
      ) : (
        <ul className="flex flex-col">
          {view.members.map((member) => (
            <li
              key={member.id}
              className="flex flex-wrap items-center gap-3 border-t border-line py-3 first:border-t-0 first:pt-0"
            >
              <div className="flex min-w-0 flex-1 basis-48 flex-col">
                <p className="font-semibold">{member.name}</p>
                <p className="text-meta text-muted tabular-nums">
                  {member.number} ·{" "}
                  {t(
                    !member.active
                      ? "desk.case.team.removed"
                      : member.linkPending
                        ? "desk.case.team.pending"
                        : "desk.case.team.active",
                  )}
                </p>
              </div>
              {member.active ? (
                <div className="flex flex-wrap gap-2">
                  {lead ? (
                    <Form method="post" replace preventScrollReset>
                      <input type="hidden" name="intent" value="renewLink" />
                      <input type="hidden" name="memberId" value={member.id} />
                      <input type="hidden" name="name" value={member.name} />
                      <Button
                        variant="secondary"
                        size="min"
                        busyLabel={busy("renewLink", member.id) ? t("desk.case.saving") : null}
                      >
                        {t("desk.case.team.renew")}
                      </Button>
                    </Form>
                  ) : null}
                  <Form method="post" replace preventScrollReset>
                    <input type="hidden" name="intent" value="removeMember" />
                    <input type="hidden" name="memberId" value={member.id} />
                    <Button
                      variant="quietDanger"
                      size="min"
                      busyLabel={busy("removeMember", member.id) ? t("desk.case.saving") : null}
                    >
                      {t("desk.case.team.remove")}
                    </Button>
                  </Form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {lead ? (
        <Form method="post" preventScrollReset className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="intent" value="member" />
          <Field id="name" label={t("desk.case.team.name")} problem={problemOf(envelope, "name")}>
            {(control) => <Input {...control} maxLength={80} autoComplete="off" />}
          </Field>
          <Field id="number" label={t("desk.case.team.number")} problem={problemOf(envelope, "number")}>
            {(control) => <Input {...control} inputMode="tel" autoComplete="off" />}
          </Field>
          <div className="sm:col-span-2">
            <Button variant="secondary" busyLabel={busy("member") ? t("desk.case.saving") : null}>
              {t("desk.case.team.add")}
            </Button>
          </div>
        </Form>
      ) : null}
    </section>
  );
}
