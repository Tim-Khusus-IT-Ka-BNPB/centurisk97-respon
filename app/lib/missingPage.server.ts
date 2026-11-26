import type { ApiCall } from "../../src/api/bridge";
import type { PlaceResults } from "../../src/contract/card";
import type { ErrorEnvelope } from "../../src/contract/errors";
import type { LanguageId } from "../../src/copy/languages";
import type { MissingLoad, MissingMine, MissingSearch, MissingVillage } from "./missingTypes";
import { PAGE_TEXTS, pickTexts } from "./texts.server";

const villagesOf = (items: PlaceResults["items"]): MissingVillage[] =>
  items.flatMap((item) =>
    item.level === "village"
      ? [{ code: item.code, name: item.name, districtName: item.districtName ?? "", regencyName: item.regencyName }]
      : [],
  );

async function searchOf(query: string, api: ApiCall): Promise<MissingSearch> {
  if (query.length === 0) return { kind: "start" };
  if (query.length < 3) return { kind: "short" };
  const response = await api("GET", `/places/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) return { kind: "unavailable" };
  const villages = villagesOf(((await response.json()) as PlaceResults).items);
  return villages.length === 0 ? { kind: "none" } : { kind: "results", villages };
}

// GET /lapor/orang-hilang: read on the server so it works with no script. A phone that has not said
// who reports is sent to say so first; then a village search, and the form under its results.
export async function loadMissingPage(url: URL, api: ApiCall, language: LanguageId): Promise<MissingLoad> {
  const texts = pickTexts(PAGE_TEXTS.missing, null, language);
  const mine = await api("GET", "/missing/mine");
  if (!mine.ok) return { kind: "whoFirst", texts };
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
  return {
    kind: "form",
    texts,
    query,
    search: await searchOf(query, api),
    mine: (await mine.json()) as MissingMine[],
    sent: url.searchParams.has("terkirim"),
  };
}

export type MissingActed =
  | { readonly kind: "sent" }
  | {
      readonly kind: "refused";
      readonly status: number;
      readonly envelope: ErrorEnvelope;
      readonly typed: Readonly<Record<string, string>>;
    };

// POST /lapor/orang-hilang: the form as typed, its photo too, on to the service.
export async function actOnMissing(form: FormData, api: ApiCall): Promise<MissingActed> {
  const response = await api("POST", "/missing", form);
  if (response.ok) return { kind: "sent" };
  const typed = Object.fromEntries(
    [...form].flatMap(([name, value]) => (typeof value === "string" ? [[name, value]] : [])),
  );
  return { kind: "refused", status: response.status, envelope: (await response.json()) as ErrorEnvelope, typed };
}
