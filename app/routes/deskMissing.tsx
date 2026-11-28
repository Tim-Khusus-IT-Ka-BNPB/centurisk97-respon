import { data, redirect } from "react-router";
import { DeskMissingView } from "../components/organisms/desk/DeskMissing";
import { DeskRefused, DeskSignIn } from "../components/organisms/desk/DeskSignIn";
import { Page, WithTexts } from "../components/templates/Page";
import { actOnDeskMissing, loadDeskMissing } from "../lib/deskPage.server";
import { pageMeta } from "../lib/meta";
import type { Route } from "./+types/deskMissing";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.desk.title", description: "meta.desk.description", path: "/desk", index: false });

export async function loader({ request, context }: Route.LoaderArgs) {
  const load = await loadDeskMissing(new URL(request.url), context.api);
  return data(load, { status: load.kind === "refused" ? load.status : 200 });
}

export async function action({ request, context }: Route.ActionArgs) {
  const acted = await actOnDeskMissing(await request.formData(), context.api, new URL(request.url));
  if (acted.kind === "redirect") return redirect(acted.location, { status: 303, headers: acted.headers });
  return data({ envelope: acted.envelope }, { status: acted.status });
}

export default function DeskMissingRoute({ loaderData, actionData }: Route.ComponentProps) {
  const load = loaderData;
  if (load.kind === "missing")
    return (
      <WithTexts texts={load.texts}>
        <DeskMissingView
          items={load.items}
          status={load.status}
          summary={load.summary}
          saved={load.saved}
          envelope={actionData?.envelope ?? null}
        />
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
