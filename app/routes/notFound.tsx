import { data, Link } from "react-router";
import { buttonStyles } from "../components/atoms/Button";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { useText } from "../lib/text";
import { PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/notFound";

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, {
    title: "page.notFound.title",
    description: "meta.notFound.description",
    path: "/lapor",
    index: false,
  });

// Any address the app does not serve answers 404 with a way back.
export const loader = () => data({ texts: pickTexts(PAGE_TEXTS.notFound) }, { status: 404 });

function NotFoundScreen() {
  const t = useText();
  return (
    <div className="flex max-w-[65ch] flex-col items-start gap-5">
      <p className="text-card">{t("notFound.body")}</p>
      <Link to="/lapor" className={buttonStyles({ variant: "primary" })}>
        {t("notFound.home")}
      </Link>
    </div>
  );
}

export default function NotFoundRoute({ loaderData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} wide banner={{ title: "notFound.title" }}>
      <NotFoundScreen />
    </Page>
  );
}
