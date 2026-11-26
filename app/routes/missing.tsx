import { data, redirect } from "react-router";
import { MissingScreen } from "../components/organisms/MissingScreen";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { actOnMissing, loadMissingPage } from "../lib/missingPage.server";
import type { Route } from "./+types/missing";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, {
    title: "page.missing.title",
    description: "meta.missing.description",
    path: "/lapor/orang-hilang",
    index: false,
  });

export async function loader({ request, context }: Route.LoaderArgs) {
  return loadMissingPage(new URL(request.url), context.api);
}

export async function action({ request, context }: Route.ActionArgs) {
  const acted = await actOnMissing(await request.formData(), context.api);
  if (acted.kind === "sent") return redirect("/lapor/orang-hilang?terkirim=1", 303);
  return data({ envelope: acted.envelope, typed: acted.typed }, { status: acted.status });
}

export default function MissingRoute({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} publicPage={false} banner={{ title: "missing.title", lead: "missing.lead" }}>
      <MissingScreen load={loaderData} envelope={actionData?.envelope ?? null} typed={actionData?.typed} />
    </Page>
  );
}
