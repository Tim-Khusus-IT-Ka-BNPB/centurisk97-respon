import { HelpScreen } from "../components/organisms/DocScreens";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/help";

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.help.title", description: "meta.help.description", path: "/lapor/help" });

export const loader = () => ({ texts: pickTexts(PAGE_TEXTS.help) });

export default function HelpRoute({ loaderData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} wide banner={{ title: "help.title", lead: "help.lead" }}>
      <HelpScreen />
    </Page>
  );
}
