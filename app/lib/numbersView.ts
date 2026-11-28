import type { DeskBpbdNumbers, DeskFacilityNumbers } from "../../src/contract/numbers";
import type { FacilityKind } from "../../src/domain/facilities";

// The numbers page shows one of two lists, as the address names it.
export type NumbersView =
  | {
      readonly tab: "bpbd";
      readonly search: { readonly q: string; readonly empty: boolean };
      readonly list: DeskBpbdNumbers;
    }
  | {
      readonly tab: "facilities";
      readonly search: { readonly q: string; readonly kind: FacilityKind | null };
      readonly list: DeskFacilityNumbers;
    };

export type NumbersSaved = "added" | "changed" | "removed";

// The page's own address for a list, a search and a page: what its links, forms and redirects use.
export function numbersLink(
  view: { readonly tab: string; readonly q: string; readonly empty?: boolean; readonly kind?: string | null },
  page = 1,
): string {
  const search = new URLSearchParams();
  if (view.tab === "facilities") search.set("tab", "facilities");
  if (view.q !== "") search.set("q", view.q);
  if (view.empty) search.set("empty", "1");
  if (view.kind) search.set("kind", view.kind);
  if (page > 1) search.set("page", String(page));
  const text = search.toString();
  return `/desk/numbers${text === "" ? "" : `?${text}`}`;
}
