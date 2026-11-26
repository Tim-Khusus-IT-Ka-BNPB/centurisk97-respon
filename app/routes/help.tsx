import { type Education, HelpScreen } from "../components/organisms/DocScreens";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { languageOf, PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/help";

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.help.title", description: "meta.help.description", path: "/lapor/help" });

// The topics come from the imported file; help still opens when they cannot be read.
export async function loader({ request, context }: Route.LoaderArgs) {
  const response = await context.api("GET", "/education");
  const education = response.ok ? ((await response.json()) as Education) : null;
  return { texts: pickTexts(PAGE_TEXTS.help, null, languageOf(request)), education };
}

export default function HelpRoute({ loaderData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} wide banner={{ title: "help.title", lead: "help.lead" }}>
      <HelpScreen education={loaderData.education} />
    </Page>
  );
}
