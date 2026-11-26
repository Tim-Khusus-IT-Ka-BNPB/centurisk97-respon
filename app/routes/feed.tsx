import type { ErrorEnvelope } from "../../src/contract/errors";
import type { Feed } from "../../src/contract/publicFeed";
import { FEED_PERIODS } from "../../src/domain/feedPeriod";
import { SELECTABLE_HAZARD_TYPES } from "../../src/domain/hazards";
import { type FeedLoad, FeedScreen, feedQuery } from "../components/organisms/FeedScreen";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { languageOf, PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/feed";

export const headers = () => ({ "cache-control": "private, no-store" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.feed.title", description: "meta.feed.description", path: "/lapor/feed" });

// Read on the server, so the list shows with no script; an unknown filter shows every hazard.
export async function loader({ request, context }: Route.LoaderArgs) {
  const search = new URL(request.url).searchParams;
  const asked = search.get("hazard");
  const hazard = SELECTABLE_HAZARD_TYPES.find((id) => id === asked) ?? null;
  const period = FEED_PERIODS.find((id) => id === search.get("period")) ?? "all";
  const response = await context.api("GET", `/feed${feedQuery(hazard, period)}`);
  const load: FeedLoad = response.ok
    ? { kind: "feed", feed: (await response.json()) as Feed }
    : { kind: "unavailable", envelope: (await response.json().catch(() => null)) as ErrorEnvelope | null };
  return { load, hazard, period, texts: pickTexts(PAGE_TEXTS.feed, null, languageOf(request)) };
}

export default function FeedRoute({ loaderData: { load, hazard, period, texts } }: Route.ComponentProps) {
  return (
    <Page texts={texts} wide>
      <FeedScreen load={load} hazard={hazard} period={period} />
    </Page>
  );
}
