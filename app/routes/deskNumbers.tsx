import { data, redirect } from "react-router";
import { DeskNumbersView } from "../components/organisms/desk/DeskNumbers";
import { DeskRefused, DeskSignIn } from "../components/organisms/desk/DeskSignIn";
import { Page, WithTexts } from "../components/templates/Page";
import { actOnDeskNumbers, loadDeskNumbers } from "../lib/deskPage.server";
import { pageMeta } from "../lib/meta";
import type { Route } from "./+types/deskNumbers";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.desk.title", description: "meta.desk.description", path: "/desk", index: false });

export async function loader({ request, context }: Route.LoaderArgs) {
  const load = await loadDeskNumbers(new URL(request.url), context.api);
  return data(load, { status: load.kind === "refused" ? load.status : 200 });
}

export async function action({ request, context }: Route.ActionArgs) {
  const acted = await actOnDeskNumbers(await request.formData(), context.api, new URL(request.url));
  if (acted.kind === "redirect") return redirect(acted.location, { status: 303, headers: acted.headers });
  return data({ envelope: acted.envelope, typed: acted.typed }, { status: acted.status });
}

export default function DeskNumbersRoute({ loaderData, actionData }: Route.ComponentProps) {
  const load = loaderData;
  if (load.kind === "numbers")
    return (
      <WithTexts texts={load.texts}>
        <DeskNumbersView view={load.view} summary={load.summary} saved={load.saved} refused={actionData ?? null} />
      </WithTexts>
    );
  return (
    <Page texts={load.texts} publicPage={false} wide>
      {load.kind === "refused" ? (
        <DeskRefused envelope={load.envelope} />
      ) : (
        <DeskSignIn envelope={null} signInUrl={load.signInUrl} />
      )}
    </Page>
  );
}
