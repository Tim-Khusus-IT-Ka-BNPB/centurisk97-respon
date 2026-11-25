import type { Card } from "../../src/contract/card";
import type { Text } from "../../src/copy/text";

type Results = NonNullable<Extract<Card, { kind: "placeSearch" }>["places"]>;
export type PlaceItem = Results["items"][number];
type AreaCard = Extract<Card, { kind: "regencyVillages" }>;

// The words of one result row: a village is picked, a regency or district opens its villages.
export function rowText(item: PlaceItem, t: Text): { readonly lead: string | null; readonly place: string } {
  if (item.level === "village")
    return {
      lead: t("card.placeSearch.rowVillage", { village: item.name }),
      place: t("card.placeSearch.rowPlace", {
        district: item.districtName ?? "",
        regency: item.regencyName,
        province: item.provinceName,
      }),
    };
  if (item.level === "district")
    return {
      lead: null,
      place: t("card.placeSearch.rowDistrict", {
        district: item.name,
        regency: item.regencyName,
        province: item.provinceName,
      }),
    };
  return {
    lead: null,
    place: t("card.placeSearch.rowRegency", { regency: item.regencyName, province: item.provinceName }),
  };
}

// The name of the area whose villages are listed. A district is named as its rows are, with
// "Kec." in front and its regency and province after, so two districts of one name differ.
export function areaName(card: AreaCard, t: Text): string {
  const name = String(card.params.areaName ?? "");
  const first = card.places?.items[0];
  if (card.areaLevel !== "district" || first === undefined) return name;
  return t("card.placeSearch.rowPlace", { district: name, regency: first.regencyName, province: first.provinceName });
}

// What the status line says after a search: the count and the cut, or that nothing matched.
export function searchStatus(card: Card, t: Text): string {
  if ((card.kind !== "placeSearch" && card.kind !== "regencyVillages") || card.places === null) return "";
  const { items, total, cut } = card.places;
  const prefix = card.kind === "placeSearch" ? "card.placeSearch" : "card.regencyVillages";
  if (total === 0) {
    const area = card.kind === "regencyVillages" ? areaName(card, t) : "";
    return t(`${prefix}.noMatch`, { query: card.query ?? "", areaName: area });
  }
  const count = t(`${prefix}.count`, { shown: items.length, total });
  return cut ? `${count} ${t(`${prefix}.cut`)}` : count;
}
