import { data, redirect } from "react-router";
import { languageFrom } from "../../src/copy/languages";
import { EmergencyStart } from "../components/organisms/EmergencyPanel";
import { StartAside, StartHeading, StartScreen } from "../components/organisms/StartScreen";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { actOnStart, isEmergency, loadStartPage, posterVillageCode } from "../lib/startPage.server";
import type { Route } from "./+types/start";

export const headers = () => ({ "cache-control": "private, no-store" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.report.title", description: "meta.report.description", path: "/report" });

export async function loader({ request, context }: Route.LoaderArgs) {
  return loadStartPage(new URL(request.url), context.api, languageFrom(request.headers.get("cookie")));
}

export async function action({ request, context }: Route.ActionArgs) {
  const url = new URL(request.url);
  const acted = await actOnStart(await request.formData(), context.api, isEmergency(url), posterVillageCode(url));
  // Who reports is known now: a missing person's report goes back to its own page.
  const location = acted.kind === "redirect" && url.searchParams.has("missing") ? "/missing" : null;
  if (acted.kind === "redirect") return redirect(location ?? acted.location, { status: 303, headers: acted.headers });
  return data(acted.data, { status: acted.status });
}

export default function StartRoute({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} publicPage={false} aside={loaderData.emergency ? null : <StartAside />}>
      {loaderData.emergency ? <EmergencyStart /> : <StartHeading />}
      <StartScreen page={loaderData} acted={actionData ?? null} />
    </Page>
  );
}
