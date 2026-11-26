import type { MeResponse } from "../../src/contract/draft";
import { HomeHero } from "../components/organisms/HomeHero";
import { HomeScreen } from "../components/organisms/HomeScreen";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/home";

export const headers = () => ({ "cache-control": "private, no-store" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.home.title", description: "meta.home.description", path: "/lapor" });

// The resume offer is read on the server; seeing it does not count as acting on the draft.
export async function loader({ context }: Route.LoaderArgs) {
  const response = await context.api("GET", "/me");
  const me = response.ok ? ((await response.json()) as MeResponse) : null;
  return { me, texts: pickTexts(PAGE_TEXTS.home) };
}

export default function HomeRoute({ loaderData: { me, texts } }: Route.ComponentProps) {
  return (
    <Page texts={texts} wide hero={<HomeHero sent={Boolean(me?.reports.length)} />}>
      <HomeScreen me={me} />
    </Page>
  );
}
