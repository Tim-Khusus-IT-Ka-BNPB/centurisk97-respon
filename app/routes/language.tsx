import { Link, redirect } from "react-router";
import { Icon } from "../components/atoms/Icon";
import { LanguageChooser } from "../components/molecules/LanguagePicker";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { useText } from "../lib/text";
import { PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import { safeReturn } from "../lib/theme";
import type { Route } from "./+types/language";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, {
    title: "page.language.title",
    description: "meta.report.description",
    path: "/lapor/bahasa",
    index: false,
  });

// GET /lapor/bahasa: the chooser as a page of its own, for a browser with no script; the page it
// came from is where it goes back to.
export function loader({ request }: Route.LoaderArgs) {
  return { back: safeReturn(new URL(request.url).searchParams.get("back")), texts: pickTexts(PAGE_TEXTS.language) };
}

// POST /lapor/bahasa: the language picker's form. The route keeps the choice in a cookie; the page
// the reporter was on is drawn again in that language. Works with no script.
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const response = await context.api("POST", "/preferences/language", { language: form.get("language") });
  const headers = new Headers();
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return redirect(safeReturn(form.get("back")), { status: 303, headers });
}

function Back({ to }: { readonly to: string }) {
  const t = useText();
  return (
    <Link
      to={to}
      aria-label={t("app.language.close")}
      className="flex size-target shrink-0 items-center justify-center rounded-full text-on-hero hover:bg-white/10"
    >
      <Icon name="x" className="size-7" />
    </Link>
  );
}

export default function LanguageRoute({ loaderData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} publicPage={false} wide>
      <div className="mx-auto w-full max-w-[56rem] card-surface p-0">
        <LanguageChooser back={loaderData.back} onClose={<Back to={loaderData.back} />} />
      </div>
    </Page>
  );
}
