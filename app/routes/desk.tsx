import { data, redirect } from "react-router";
import { DeskQueueView } from "../components/organisms/desk/DeskQueue";
import { DeskRefused, DeskSignIn } from "../components/organisms/desk/DeskSignIn";
import { Page, WithTexts } from "../components/templates/Page";
import { actOnDesk, loadDeskQueue } from "../lib/deskPage.server";
import { pageMeta } from "../lib/meta";
import type { Route } from "./+types/desk";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.desk.title", description: "meta.desk.description", path: "/desk", index: false });

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
  if (load.kind === "queue")
    return (
      <WithTexts texts={load.texts}>
        <DeskQueueView shown={load.shown} summary={load.summary} filters={load.filters} envelope={load.envelope} />
      </WithTexts>
    );
  return (
    <Page texts={load.texts} publicPage={false} wide>
      {load.kind === "refused" ? (
        <DeskRefused envelope={load.envelope} />
      ) : (
        <DeskSignIn envelope={actionData ?? null} signInUrl={load.signInUrl} />
      )}
    </Page>
  );
}
