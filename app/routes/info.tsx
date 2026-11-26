import type { PlaceResults } from "../../src/contract/card";
import type { OutlookView } from "../../src/contract/outlook";
import { type InfoLoad, InfoScreen } from "../components/organisms/InfoScreen";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { languageOf, PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/info";

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.info.title", description: "meta.info.description", path: "/lapor/info" });

const REGENCY = /^\d{2}\.\d{2}$/;

// Each place found stands for its regency, once.
const regenciesOf = (items: PlaceResults["items"]) => [
  ...new Map(
    items.map((item) => {
      const code = item.code.slice(0, 5);
      const name = item.level === "regency" ? item.name : item.regencyName;
      return [code, { code, name, provinceName: item.provinceName }] as const;
    }),
  ).values(),
];

// Read on the server, so it opens with no script: a search, or a regency's outlook.
export async function loader({ request, context }: Route.LoaderArgs) {
  const search = new URL(request.url).searchParams;
  const regency = search.get("kab") ?? "";
  const query = (search.get("q") ?? "").trim();
  const texts = pickTexts(PAGE_TEXTS.info, null, languageOf(request));
  let load: InfoLoad = { kind: "start", query };
  if (REGENCY.test(regency)) {
    const response = await context.api("GET", `/outlook?regency=${regency}`);
    load = response.ok
      ? { kind: "outlook", query, outlook: (await response.json()) as OutlookView }
      : { kind: response.status === 404 ? "none" : "unavailable", query };
  } else if (query.length >= 3) {
    const response = await context.api("GET", `/places/search?q=${encodeURIComponent(query)}`);
    load = response.ok
      ? { kind: "results", query, regencies: regenciesOf(((await response.json()) as PlaceResults).items) }
      : { kind: "unavailable", query };
  } else if (query.length > 0) load = { kind: "short", query };
  return { load, texts };
}

export default function InfoRoute({ loaderData: { load, texts } }: Route.ComponentProps) {
  return (
    <Page texts={texts} wide banner={{ title: "info.title", lead: "info.lead" }}>
      <InfoScreen load={load} />
    </Page>
  );
}
