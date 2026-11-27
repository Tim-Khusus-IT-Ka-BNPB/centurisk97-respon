import { data } from "react-router";
import type { ErrorEnvelope } from "../../src/contract/errors";
import type { Today } from "../../src/contract/today";
import { SELECTABLE_HAZARD_TYPES } from "../../src/domain/hazards";
import { type TodayLoad, TodayScreen } from "../components/organisms/TodayScreen";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { languageOf, PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/today";

export const headers = () => ({ "cache-control": "private, no-store" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.today.title", description: "meta.today.description", path: "/today" });

// Read on the server, so the list shows with no script. Every kind is read at once, the same for all
// readers at the edge; the chosen kind is picked from it here. Shut, the page answers 404.
export async function loader({ request, context }: Route.LoaderArgs) {
  const texts = pickTexts(PAGE_TEXTS.today, null, languageOf(request));
  const asked = new URL(request.url).searchParams.get("hazard");
  const hazard = SELECTABLE_HAZARD_TYPES.find((id) => id === asked) ?? null;
  const response = await context.api("GET", "/today");
  if (response.status === 404) return data({ load: { kind: "closed" } as TodayLoad, hazard, texts }, { status: 404 });
  const load: TodayLoad = response.ok
    ? { kind: "today", today: (await response.json()) as Today }
    : { kind: "unavailable", envelope: (await response.json().catch(() => null)) as ErrorEnvelope | null };
  return { load, hazard, texts };
}

export default function TodayRoute({ loaderData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} wide banner={{ title: "today.title", lead: "today.lead" }}>
      <TodayScreen load={loaderData.load} hazard={loaderData.hazard} />
    </Page>
  );
}
