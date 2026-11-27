import type { ErrorEnvelope } from "../../src/contract/errors";
import type { Feed, Official, Watch } from "../../src/contract/publicFeed";
import { FEED_PERIODS } from "../../src/domain/feedPeriod";
import { SELECTABLE_HAZARD_TYPES } from "../../src/domain/hazards";
import { type FeedLoad, FeedScreen, feedQuery } from "../components/organisms/FeedScreen";
import { type WatchLoad, WatchScreen } from "../components/organisms/WatchScreen";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { languageOf, PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/feed";

export const headers = () => ({ "cache-control": "private, no-store" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.feed.title", description: "meta.feed.description", path: "/feed" });

// Read on the server, so the list shows with no script; an unknown filter shows every hazard.
export async function loader({ request, context }: Route.LoaderArgs) {
  const search = new URL(request.url).searchParams;
  const texts = pickTexts(PAGE_TEXTS.feed, null, languageOf(request));
  // The Peringatan view (DP-11): what is on watch rather than what happened.
  if (search.get("mode") === "peringatan") {
    const response = await context.api("GET", "/feed/watch");
    const watch: WatchLoad = response.ok
      ? { kind: "watch", watch: (await response.json()) as Watch }
      : { kind: "unavailable", envelope: (await response.json().catch(() => null)) as ErrorEnvelope | null };
    return { mode: "watch" as const, watch, texts };
  }
  const asked = search.get("hazard");
  const hazard = SELECTABLE_HAZARD_TYPES.find((id) => id === asked) ?? null;
  const period = FEED_PERIODS.find((id) => id === search.get("period")) ?? "all";
  const [response, officialAnswer] = await Promise.all([
    context.api("GET", `/feed${feedQuery(hazard, period)}`),
    context.api("GET", "/feed/official"),
  ]);
  const load: FeedLoad = response.ok
    ? { kind: "feed", feed: (await response.json()) as Feed }
    : { kind: "unavailable", envelope: (await response.json().catch(() => null)) as ErrorEnvelope | null };
  // BNPB's daily report beside them; not read, it says so on its own.
  const official = officialAnswer.ok ? ((await officialAnswer.json()) as Official) : null;
  return { mode: "events" as const, load, hazard, period, official, texts };
}

export default function FeedRoute({ loaderData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} wide>
      {loaderData.mode === "watch" ? (
        <WatchScreen load={loaderData.watch} />
      ) : (
        <FeedScreen
          load={loaderData.load}
          hazard={loaderData.hazard}
          period={loaderData.period}
          official={loaderData.official}
        />
      )}
    </Page>
  );
}
