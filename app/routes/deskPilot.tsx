import { data, redirect } from "react-router";
import { DeskPilotView } from "../components/organisms/desk/DeskPilot";
import { DeskRefused, DeskSignIn } from "../components/organisms/desk/DeskSignIn";
import { Page, WithTexts } from "../components/templates/Page";
import { actOnDeskPilot, loadDeskPilot } from "../lib/deskPage.server";
import { pageMeta } from "../lib/meta";
import type { Route } from "./+types/deskPilot";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.desk.title", description: "meta.desk.description", path: "/lapor/meja", index: false });

export async function loader({ context }: Route.LoaderArgs) {
  const load = await loadDeskPilot(context.api);
  return data(load, { status: load.kind === "refused" ? load.status : 200 });
}

export async function action({ request, context }: Route.ActionArgs) {
  const acted = await actOnDeskPilot(await request.formData(), context.api);
  if (acted.kind === "redirect") return redirect(acted.location, { status: 303, headers: acted.headers });
  return data({ envelope: acted.envelope, typed: acted.typed }, { status: acted.status });
}

export default function DeskPilotRoute({ loaderData, actionData }: Route.ComponentProps) {
  const load = loaderData;
  if (load.kind === "pilot")
    return (
      <WithTexts texts={load.texts}>
        <DeskPilotView
          pilot={load.pilot}
          summary={load.summary}
          envelope={actionData?.envelope}
          typed={actionData?.typed}
        />
      </WithTexts>
    );
  return (
    <Page texts={load.texts} publicPage={false} wide>
      {load.kind === "refused" ? <DeskRefused envelope={load.envelope} /> : <DeskSignIn envelope={null} />}
    </Page>
  );
}
