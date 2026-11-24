import { TrackingScreen } from "../components/organisms/TrackingScreen";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/tracking";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, {
    title: "page.tracking.title",
    description: "meta.tracking.description",
    path: "/lapor/lacak",
    index: false,
  });

export const loader = () => ({ texts: pickTexts(PAGE_TEXTS.tracking) });

export default function TrackingRoute({ loaderData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} publicPage={false} wide>
      <TrackingScreen />
    </Page>
  );
}
