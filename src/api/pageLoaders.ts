import type { Card } from "../contract/card";
import type { DraftBody } from "../contract/draft";
import type { ErrorEnvelope } from "../contract/errors";
import { areaLevelOf } from "../domain/placeSearch";
import type { ApiCall } from "./bridge";

// GET /report/<draftId>: the draft page, with place search answered on the server so it
// works with no script. "q" is the typed place text, "area" a regency or district code picked
// from the results.
export type DraftPageLoad =
  | {
      readonly kind: "draft";
      readonly status: number;
      readonly draft: DraftBody;
      // A refused search (too short, limit, place data unreadable); the draft stays at place.
      readonly envelope: ErrorEnvelope | null;
    }
  | { readonly kind: "refused"; readonly status: number; readonly envelope: ErrorEnvelope };

type Results = Extract<Card, { kind: "placeSearch" }>["places"] & object;
type AreaResults = Results & { readonly area: { readonly name: string } };

const AREA_SEGMENT = { regency: "regencies", district: "districts" } as const;

const withCard = (
  draft: DraftBody,
  card: Card,
  status = 200,
  envelope: ErrorEnvelope | null = null,
): DraftPageLoad => ({
  kind: "draft",
  status,
  draft: { ...draft, card },
  envelope,
});

const placesOf = ({ items, total, cut, dataDate }: Results): Results => ({ items, total, cut, dataDate });

// The place the reporter last named in their own words, which Sigap said back.
function namedPlace(draft: DraftBody): string | null {
  const line = draft.transcript.findLast(
    (entry) => entry.speaker === "assistant" && entry.copyKey === "reply.notedPlace",
  );
  return line?.speaker === "assistant" ? String(line.params.place) : null;
}

// Nothing typed yet: the place the reporter named is searched for them, so they only pick their
// village. A search that finds nothing or is refused leaves the card as it was.
async function namedSearch(draft: DraftBody, card: Card & { readonly kind: "placeSearch" }, api: ApiCall) {
  const named = namedPlace(draft);
  if (named === null) return withCard(draft, card);
  const found = await api("GET", `/places/search?q=${encodeURIComponent(named)}`);
  const places = found.ok ? placesOf((await found.json()) as Results) : null;
  return places === null || places.total === 0
    ? withCard(draft, card)
    : withCard(draft, { ...card, query: named, places, named: true });
}

export async function draftPageLoad(draftId: string, search: URLSearchParams, api: ApiCall): Promise<DraftPageLoad> {
  const response = await api("GET", `/drafts/${encodeURIComponent(draftId)}`);
  if (!response.ok)
    return { kind: "refused", status: response.status, envelope: (await response.json()) as ErrorEnvelope };
  const draft = (await response.json()) as DraftBody;
  const card = draft.card;
  if (card.kind !== "placeSearch") return withCard(draft, card);
  const query = (search.get("q") ?? "").trim();
  const areaCode = search.get("area") ?? "";
  const areaLevel = areaLevelOf(areaCode);
  const typed = { ...card, query: query === "" ? null : query };
  const q = encodeURIComponent(query);

  if (areaLevel !== null) {
    const found = await api("GET", `/places/${AREA_SEGMENT[areaLevel]}/${areaCode}/villages?q=${q}`);
    if (found.ok) {
      const results = (await found.json()) as AreaResults;
      return withCard(draft, {
        cardId: card.cardId,
        kind: "regencyVillages",
        titleKey: "card.regencyVillages.title",
        promptKey: "card.regencyVillages.prompt",
        params: { areaName: results.area.name },
        areaCode,
        areaLevel,
        query: typed.query,
        places: placesOf(results),
      });
    }
    // An area not in the place data is ignored: the reporter searches the country again.
    if (found.status !== 404) return withCard(draft, typed, found.status, (await found.json()) as ErrorEnvelope);
  }
  if (query === "") return namedSearch(draft, card, api);
  const found = await api("GET", `/places/search?q=${q}`);
  if (!found.ok) return withCard(draft, typed, found.status, (await found.json()) as ErrorEnvelope);
  return withCard(draft, { ...typed, places: placesOf((await found.json()) as Results) });
}
