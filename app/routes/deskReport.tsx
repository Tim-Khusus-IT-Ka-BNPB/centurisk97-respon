import { data, redirect } from "react-router";
import { DeskReportView } from "../components/organisms/desk/DeskReport";
import { DeskRefused, DeskSignIn } from "../components/organisms/desk/DeskSignIn";
import { Page, WithTexts } from "../components/templates/Page";
import { actOnDeskReport, loadDeskReport } from "../lib/deskPage.server";
import { pageMeta } from "../lib/meta";
import type { Route } from "./+types/deskReport";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.desk.title", description: "meta.desk.description", path: "/desk", index: false });

export async function loader({ params, context }: Route.LoaderArgs) {
  const load = await loadDeskReport(params.ticketNumber, context.api);
  return data(load, { status: load.kind === "refused" ? load.status : 200 });
}

// What an answer on the page shows beside the report; one thing at a time.
const NOTHING = { envelope: null, typed: null, identity: null, officer: null, trackingLink: null };

export async function action({ params, request, context }: Route.ActionArgs) {
  const acted = await actOnDeskReport(params.ticketNumber, await request.formData(), context.api);
  if (acted.kind === "redirect") return redirect(acted.location, { status: 303, headers: acted.headers });
  if (acted.kind === "done") return null;
  if (acted.kind === "identity") return data({ ...NOTHING, identity: acted.identity });
  if (acted.kind === "officerNumber") return data({ ...NOTHING, officer: acted.officer });
  if (acted.kind === "trackingLink") return data({ ...NOTHING, trackingLink: acted.link });
  return data({ ...NOTHING, envelope: acted.envelope, typed: acted.typed }, { status: acted.status });
}

export default function DeskReportRoute({ loaderData, actionData }: Route.ComponentProps) {
  const load = loaderData;
  if (load.kind === "report")
    return (
      <WithTexts texts={load.texts}>
        <DeskReportView
          report={load.report}
          summary={load.summary}
          refusal={actionData?.envelope}
          typed={actionData?.typed}
          identity={actionData?.identity}
          officer={actionData?.officer}
          trackingLink={actionData?.trackingLink}
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
