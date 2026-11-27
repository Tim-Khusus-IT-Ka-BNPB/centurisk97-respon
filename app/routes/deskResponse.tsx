import { data, redirect } from "react-router";
import { DeskResponseView } from "../components/organisms/desk/DeskResponse";
import { DeskRefused, DeskSignIn } from "../components/organisms/desk/DeskSignIn";
import { Page, WithTexts } from "../components/templates/Page";
import { loadDeskResponse, pauseWarnings } from "../lib/deskPage.server";
import { pageMeta } from "../lib/meta";
import type { Route } from "./+types/deskResponse";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.desk.title", description: "meta.desk.description", path: "/desk", index: false });

export async function loader({ request, context }: Route.LoaderArgs) {
  const load = await loadDeskResponse(new URL(request.url).searchParams.get("month"), context.api);
  return data(load, { status: load.kind === "refused" ? load.status : 200 });
}

// The pause posts here and comes back to the same month; a refusal says so on the page.
export async function action({ request, context }: Route.ActionArgs) {
  const kept = await pauseWarnings(await request.formData(), context.api);
  const url = new URL(request.url);
  if (!kept) url.searchParams.set("refused", "warnings");
  else url.searchParams.delete("refused");
  return redirect(`${url.pathname}${url.search}`, { status: 303 });
}

export default function DeskResponseRoute({ loaderData }: Route.ComponentProps) {
  const load = loaderData;
  if (load.kind === "response")
    return (
      <WithTexts texts={load.texts}>
        <DeskResponseView response={load.response} summary={load.summary} warnings={load.warnings} />
      </WithTexts>
    );
  return (
    <Page texts={load.texts} publicPage={false} wide>
      {load.kind === "refused" ? <DeskRefused envelope={load.envelope} /> : <DeskSignIn envelope={null} />}
    </Page>
  );
}
