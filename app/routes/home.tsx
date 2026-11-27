import type { MeResponse } from "../../src/contract/draft";
import { HomeHero } from "../components/organisms/HomeHero";
import { HomeScreen } from "../components/organisms/HomeScreen";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import type { MissingMine } from "../lib/missingTypes";
import { languageOf, PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/home";

export const headers = () => ({ "cache-control": "private, no-store" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.home.title", description: "meta.home.description", path: "/" });

// The resume offer is read on the server; seeing it does not count as acting on the draft.
// The missing persons this phone reported show in Laporan saya too; a phone nobody reported from
// has none.
export async function loader({ request, context }: Route.LoaderArgs) {
  const [response, sought] = await Promise.all([context.api("GET", "/me"), context.api("GET", "/missing/mine")]);
  const me = response.ok ? ((await response.json()) as MeResponse) : null;
  const missing = sought.ok ? ((await sought.json()) as MissingMine[]) : [];
  return { me, missing, texts: pickTexts(PAGE_TEXTS.home, null, languageOf(request)) };
}

export default function HomeRoute({ loaderData: { me, missing, texts } }: Route.ComponentProps) {
  return (
    <Page texts={texts} wide hero={<HomeHero sent={Boolean(me?.reports.length)} />}>
      <HomeScreen me={me} missing={missing} />
    </Page>
  );
}
