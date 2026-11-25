import { data } from "react-router";
import { DeskResponseView } from "../components/organisms/desk/DeskResponse";
import { DeskRefused, DeskSignIn } from "../components/organisms/desk/DeskSignIn";
import { Page, WithTexts } from "../components/templates/Page";
import { loadDeskResponse } from "../lib/deskPage.server";
import { pageMeta } from "../lib/meta";
import type { Route } from "./+types/deskResponse";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.desk.title", description: "meta.desk.description", path: "/lapor/meja", index: false });

export async function loader({ request, context }: Route.LoaderArgs) {
  const load = await loadDeskResponse(new URL(request.url).searchParams.get("month"), context.api);
  return data(load, { status: load.kind === "refused" ? load.status : 200 });
}

export default function DeskResponseRoute({ loaderData }: Route.ComponentProps) {
  const load = loaderData;
  if (load.kind === "response")
    return (
      <WithTexts texts={load.texts}>
        <DeskResponseView response={load.response} summary={load.summary} />
      </WithTexts>
    );
  return (
    <Page texts={load.texts} publicPage={false} wide>
      {load.kind === "refused" ? <DeskRefused envelope={load.envelope} /> : <DeskSignIn envelope={null} />}
    </Page>
  );
}
