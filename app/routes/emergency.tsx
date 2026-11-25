import { redirect } from "react-router";
import type { OneTapStart } from "../../src/contract/emergency";
import { OneTapScreen } from "../components/organisms/OneTapScreen";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/emergency";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, {
    title: "page.emergency.title",
    description: "meta.emergency.description",
    path: "/lapor/darurat",
    index: false,
  });

// One tap is for a reporter known on this phone; anyone else is led to the short conversation.
export async function loader({ context }: Route.LoaderArgs) {
  const response = await context.api("GET", "/emergencies/start");
  if (!response.ok) return redirect("/lapor/report?darurat=1");
  return { start: (await response.json()) as OneTapStart, texts: pickTexts(PAGE_TEXTS.emergency) };
}

export default function EmergencyRoute({ loaderData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} publicPage={false}>
      <OneTapScreen start={loaderData.start} />
    </Page>
  );
}
