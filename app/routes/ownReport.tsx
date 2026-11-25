import { data } from "react-router";
import { RefusedScreen } from "../components/organisms/DraftScreen";
import { OwnReportScreen } from "../components/organisms/OwnReportScreen";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { loadOwnReport } from "../lib/ownReportPage.server";
import type { Route } from "./+types/ownReport";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, {
    title: "page.ownReport.title",
    description: "meta.ownReport.description",
    path: "/lapor",
    index: false,
  });

export async function loader({ params, context }: Route.LoaderArgs) {
  const load = await loadOwnReport(params.ticketNumber, context.api);
  return data(load, { status: load.kind === "refused" ? load.status : 200 });
}

export default function OwnReportRoute({ loaderData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} publicPage={false} wide={loaderData.kind === "report"}>
      {loaderData.kind === "report" ? (
        <OwnReportScreen report={loaderData.report} />
      ) : (
        <RefusedScreen envelope={loaderData.envelope} />
      )}
    </Page>
  );
}
