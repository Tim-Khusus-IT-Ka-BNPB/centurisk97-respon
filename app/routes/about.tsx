import { AboutScreen } from "../components/organisms/DocScreens";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { languageOf, PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/about";

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.about.title", description: "meta.about.description", path: "/about" });

export const loader = ({ request }: Route.LoaderArgs) => ({
  texts: pickTexts(PAGE_TEXTS.about, null, languageOf(request)),
});

export default function AboutRoute({ loaderData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} wide banner={{ title: "about.title", lead: "about.lead" }}>
      <AboutScreen />
    </Page>
  );
}
