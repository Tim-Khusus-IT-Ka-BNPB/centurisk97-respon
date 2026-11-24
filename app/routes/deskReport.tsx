import { data, redirect } from "react-router";
import { DeskRefused, DeskReportView, DeskSignIn } from "../components/organisms/DeskScreens";
import { Page } from "../components/templates/Page";
import { actOnDeskReport, loadDeskReport } from "../lib/deskPage.server";
import { pageMeta } from "../lib/meta";
import type { Route } from "./+types/deskReport";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.desk.title", description: "meta.desk.description", path: "/lapor/meja", index: false });

export async function loader({ params, context }: Route.LoaderArgs) {
  const load = await loadDeskReport(params.ticketNumber, context.api);
  return data(load, { status: load.kind === "refused" ? load.status : 200 });
}

export async function action({ params, context }: Route.ActionArgs) {
  const acted = await actOnDeskReport(params.ticketNumber, context.api);
  if (acted.kind === "redirect") return redirect(acted.location, { status: 303, headers: acted.headers });
  return data(acted.envelope, { status: acted.status });
}

export default function DeskReportRoute({ loaderData, actionData }: Route.ComponentProps) {
  const load = loaderData;
  return (
    <Page texts={load.texts} publicPage={false} wide>
      {actionData ? <DeskRefused envelope={actionData} /> : null}
      {load.kind === "report" ? (
        <DeskReportView report={load.report} />
      ) : load.kind === "refused" ? (
        <DeskRefused envelope={load.envelope} />
      ) : (
        <DeskSignIn envelope={null} />
      )}
    </Page>
  );
}
