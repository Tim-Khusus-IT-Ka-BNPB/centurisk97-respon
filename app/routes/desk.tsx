import { data, redirect } from "react-router";
import { DeskQueueView, DeskRefused, DeskSignIn } from "../components/organisms/DeskScreens";
import { Page } from "../components/templates/Page";
import { actOnDesk, loadDeskQueue } from "../lib/deskPage.server";
import { pageMeta } from "../lib/meta";
import type { Route } from "./+types/desk";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.desk.title", description: "meta.desk.description", path: "/lapor/meja", index: false });

export async function loader({ request, context }: Route.LoaderArgs) {
  const load = await loadDeskQueue(new URL(request.url), context.api);
  return data(load, { status: load.kind === "refused" ? load.status : 200 });
}

export async function action({ request, context }: Route.ActionArgs) {
  const acted = await actOnDesk(await request.formData(), context.api);
  if (acted.kind === "redirect") return redirect(acted.location, { status: 303, headers: acted.headers });
  return data(acted.envelope, { status: acted.status });
}

export default function DeskRoute({ loaderData, actionData }: Route.ComponentProps) {
  const load = loaderData;
  return (
    <Page texts={load.texts} publicPage={false} wide>
      {load.kind === "queue" ? (
        <DeskQueueView queue={load.queue} filters={load.filters} envelope={load.envelope} />
      ) : load.kind === "refused" ? (
        <DeskRefused envelope={load.envelope} />
      ) : (
        <DeskSignIn envelope={actionData ?? null} />
      )}
    </Page>
  );
}
