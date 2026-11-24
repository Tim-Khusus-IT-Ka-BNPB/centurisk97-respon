import { data, redirect } from "react-router";
import { StartScreen } from "../components/organisms/StartScreen";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { actOnStart, loadStartPage } from "../lib/startPage.server";
import type { Route } from "./+types/start";

export const headers = () => ({ "cache-control": "private, no-store" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.report.title", description: "meta.report.description", path: "/lapor/report" });

export async function loader({ request, context }: Route.LoaderArgs) {
  return loadStartPage(new URL(request.url), context.api);
}

export async function action({ request, context }: Route.ActionArgs) {
  const acted = await actOnStart(await request.formData(), context.api);
  if (acted.kind === "redirect") return redirect(acted.location, { status: 303, headers: acted.headers });
  return data(acted.data, { status: acted.status });
}

export default function StartRoute({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} publicPage={false}>
      <StartScreen page={loaderData} acted={actionData ?? null} />
    </Page>
  );
}
