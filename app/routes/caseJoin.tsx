import { data, Form, redirect } from "react-router";
import { Button } from "../components/atoms/Button";
import { Notice } from "../components/molecules/Notice";
import { Page } from "../components/templates/Page";
import { caseTexts, joinCase } from "../lib/casePage.server";
import { pageMeta } from "../lib/meta";
import { useText } from "../lib/text";
import type { Route } from "./+types/caseJoin";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.case.title", description: "meta.case.description", path: "/lapor/data", index: false });

// The link is used only by the button: a link preview or a scanner opening it changes nothing.
export const loader = () => ({ texts: caseTexts() });

export async function action({ params, context }: Route.ActionArgs) {
  const acted = await joinCase(params.token, context.api);
  if (acted.kind === "joined") return redirect(acted.location, { status: 303, headers: acted.headers });
  return data({ envelope: acted.envelope }, { status: 404 });
}

function Join({ refused }: { readonly refused: boolean }) {
  const t = useText();
  return (
    <div className="flex max-w-[60ch] flex-col items-start gap-4 card-surface p-5">
      {refused ? <Notice kind="error">{t("error.cases.linkUsed")}</Notice> : null}
      <p>{t("desk.case.join.lead")}</p>
      <Form method="post">
        <Button variant="primary">{t("desk.case.join.button")}</Button>
      </Form>
    </div>
  );
}

export default function CaseJoinRoute({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} publicPage={false} banner={{ title: "desk.case.join" }}>
      <Join refused={actionData !== undefined} />
    </Page>
  );
}
