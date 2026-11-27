import { data, Link } from "react-router";
import { buttonStyles } from "../components/atoms/Button";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { useText } from "../lib/text";
import { languageOf, PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/notFound";

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, {
    title: "page.notFound.title",
    description: "meta.notFound.description",
    path: "/",
    index: false,
  });

// Any address the app does not serve answers 404 with a way back.
export const loader = ({ request }: Route.LoaderArgs) =>
  data({ texts: pickTexts(PAGE_TEXTS.notFound, null, languageOf(request)) }, { status: 404 });

function NotFoundScreen() {
  const t = useText();
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Link to="/" className={buttonStyles({ variant: "primary", size: "main", className: "px-7" })}>
        {t("notFound.home")}
      </Link>
      <Link to="/help" className={buttonStyles({ size: "main", className: "px-7" })}>
        {t("help.title")}
      </Link>
    </div>
  );
}

export default function NotFoundRoute({ loaderData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} wide banner={{ title: "notFound.title", lead: "notFound.body" }}>
      <NotFoundScreen />
    </Page>
  );
}
