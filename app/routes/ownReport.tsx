import { data, redirect, type ShouldRevalidateFunctionArgs, useRouteLoaderData } from "react-router";
import { RefusedScreen } from "../components/organisms/DraftScreen";
import { OwnReportScreen } from "../components/organisms/OwnReportScreen";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { actOnOwnReport, loadOwnReport } from "../lib/ownReportPage.server";
import { languageOf } from "../lib/texts.server";
import type { Route } from "./+types/ownReport";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, {
    title: "page.ownReport.title",
    description: "meta.ownReport.description",
    path: "/",
    index: false,
  });

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const load = await loadOwnReport(params.ticketNumber, context.api, languageOf(request));
  return data(load, { status: load.kind === "refused" ? load.status : 200 });
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const acted = await actOnOwnReport(params.ticketNumber, await request.formData(), context.api);
  if (acted.kind === "redirect") return redirect(acted.location, 303);
  return acted.kind === "done" ? null : data({ envelope: acted.envelope }, { status: acted.status });
}

// News marked as read keeps its marks on the page it was read on.
export const shouldRevalidate = ({ formData, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) =>
  formData?.get("action") === "newsRead" ? false : defaultShouldRevalidate;

export default function OwnReportRoute({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<{ origin: string }>("root");
  return (
    <Page texts={loaderData.texts} publicPage={false} wide={loaderData.kind === "report"}>
      {loaderData.kind === "report" ? (
        <OwnReportScreen report={loaderData.report} origin={root?.origin ?? ""} envelope={actionData?.envelope} />
      ) : (
        <RefusedScreen envelope={loaderData.envelope} />
      )}
    </Page>
  );
}
