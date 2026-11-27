import { data, redirect } from "react-router";
import { CaseScreen } from "../components/organisms/case/CaseScreen";
import { DeskRefused } from "../components/organisms/desk/DeskSignIn";
import { Page } from "../components/templates/Page";
import { actOnCase, loadCase } from "../lib/casePage.server";
import { pageMeta } from "../lib/meta";
import { useText } from "../lib/text";
import type { Route } from "./+types/caseFile";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.case.title", description: "meta.case.description", path: "/lapor/data", index: false });

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const load = await loadCase(params.fileId, new URL(request.url), context.api);
  return data(load, { status: load.kind === "refused" ? load.status : load.kind === "signIn" ? 401 : 200 });
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const acted = await actOnCase(params.fileId, await request.formData(), context.api);
  if (acted.kind === "redirect") return redirect(acted.location, 303);
  if (acted.kind === "link")
    return { envelope: null, typed: null, link: { link: acted.link, name: acted.name }, revealed: null };
  if (acted.kind === "revealed")
    return {
      envelope: null,
      typed: null,
      link: null,
      revealed: { recordId: acted.recordId, personal: acted.personal },
    };
  return data({ envelope: acted.envelope, typed: acted.typed, link: null, revealed: null }, { status: acted.status });
}

function SignIn() {
  const t = useText();
  return <p className="max-w-[60ch] card-surface p-5">{t("desk.case.signIn")}</p>;
}

export default function CaseFileRoute({ loaderData, actionData }: Route.ComponentProps) {
  const load = loaderData;
  if (load.kind !== "file")
    return (
      <Page texts={load.texts} publicPage={false} banner={{ title: "desk.case.title" }}>
        {load.kind === "signIn" ? <SignIn /> : <DeskRefused envelope={load.envelope} />}
      </Page>
    );
  return (
    <Page texts={load.texts} publicPage={false} wide banner={{ title: "desk.case.title", lead: "desk.case.lead" }}>
      <CaseScreen
        view={load.view}
        tab={load.tab}
        answered={actionData ?? { envelope: null, typed: null, link: null, revealed: null }}
      />
    </Page>
  );
}
