import { PrivacyScreen } from "../components/organisms/DocScreens";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { languageOf, PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/privacy";

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.privacy.title", description: "meta.privacy.description", path: "/privacy" });

export const loader = ({ request }: Route.LoaderArgs) => ({
  texts: pickTexts(PAGE_TEXTS.privacy, null, languageOf(request)),
});

export default function PrivacyRoute({ loaderData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} wide banner={{ title: "privacy.title" }}>
      <PrivacyScreen />
    </Page>
  );
}
