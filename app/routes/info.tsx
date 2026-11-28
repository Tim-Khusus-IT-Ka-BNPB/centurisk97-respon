import { redirect } from "react-router";
import type { PlaceResults } from "../../src/contract/card";
import type { OutlookView } from "../../src/contract/outlook";
import { type InfoLoad, InfoScreen, type Located } from "../components/organisms/InfoScreen";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { languageOf, PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/info";

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, { title: "page.info.title", description: "meta.info.description", path: "/info" });

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
  const regency = search.get("regency") ?? "";
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

// POST /info: the phone's reading, as its regency's three days. The reading is read and dropped.
export async function action({ request, context }: Route.ActionArgs): Promise<{ readonly located: Located }> {
  const form = await request.formData();
  const number = (name: string) => Number(form.get(name));
  const response = await context.api("POST", "/places/at", {
    lat: number("lat"),
    lon: number("lon"),
    accuracyM: number("accuracy"),
  });
  if (response.ok) {
    const { regency } = (await response.json()) as { readonly regency: { readonly code: string } };
    throw redirect(`/info?regency=${regency.code}`, 303);
  }
  return { located: response.status === 404 || response.status === 400 ? "none" : "unavailable" };
}

export default function InfoRoute({ loaderData: { load, texts }, actionData }: Route.ComponentProps) {
  return (
    <Page
      texts={texts}
      wide
      banner={{ title: "info.title", lead: "info.lead", sigap: { scene: "info", copy: "sigap.info" } }}
    >
      <InfoScreen load={load} located={actionData?.located ?? null} />
    </Page>
  );
}
