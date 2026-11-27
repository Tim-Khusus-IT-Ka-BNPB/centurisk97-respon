import { useRouteLoaderData } from "react-router";
import type { PlaceResults } from "../../src/contract/card";
import { type PosterLoad, PosterScreen } from "../components/organisms/PosterScreen";
import { WithTexts } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/poster";

export const headers = () => ({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, {
    title: "page.poster.title",
    description: "meta.poster.description",
    path: "/poster",
    index: false,
  });

const DISTRICT = /^\d{2}\.\d{2}\.\d{2}$/;
const VILLAGE = /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/;

type Area = PlaceResults & { readonly area: { readonly name: string; readonly regencyName: string } };

// Read on the server, so it works and prints with no script: a search, or a district's villages.
export async function loader({ request, context }: Route.LoaderArgs) {
  const search = new URL(request.url).searchParams;
  const district = search.get("district") ?? "";
  const village = search.get("village") ?? "";
  const query = (search.get("q") ?? "").trim();
  const texts = pickTexts(PAGE_TEXTS.poster);
  let load: PosterLoad = { kind: "start", query };
  if (DISTRICT.test(district)) {
    const response = await context.api("GET", `/places/districts/${district}/villages?q=`);
    if (!response.ok) load = { kind: "unavailable", query };
    else {
      const found = (await response.json()) as Area;
      const villages = found.items.filter((item) => item.level === "village");
      const one = VILLAGE.test(village) ? villages.filter((item) => item.code === village) : [];
      load = {
        kind: "sheets",
        query,
        area: found.area,
        district,
        villages: one.length > 0 ? one : villages,
        one: one.length > 0,
        cut: one.length === 0 && found.cut,
      };
    }
  } else if (query.length >= 3) {
    const response = await context.api("GET", `/places/search?q=${encodeURIComponent(query)}`);
    load = response.ok
      ? { kind: "results", query, items: ((await response.json()) as PlaceResults).items }
      : { kind: "unavailable", query };
  } else if (query.length > 0) load = { kind: "short", query };
  return { load, texts };
}

export default function PosterRoute({ loaderData: { load, texts } }: Route.ComponentProps) {
  const root = useRouteLoaderData<{ origin: string }>("root");
  return (
    <WithTexts texts={texts}>
      <PosterScreen load={load} origin={root?.origin ?? ""} />
    </WithTexts>
  );
}
