import type { Card } from "../../src/contract/card";
import { unitKeyOf } from "./fields";
import type { Text } from "./text";
import { localClockText, localDateText } from "./time";

type Group = Extract<Card, { kind: "summary" }>["groups"][number];
type Row = Group["rows"][number];
type RowValue = NonNullable<Row["value"]>;

const list = new Intl.ListFormat("id-ID", { style: "long", type: "conjunction" });
const count = new Intl.NumberFormat("id-ID");

// The text of one key with a placeholder left open, split around it, so an element (a chip, the
// ticket number) can sit where the placeholder was.
const MARK = "\u0001";
export function splitAround(t: Text, key: string, params: Readonly<Record<string, string | number>>, open: string) {
  const [before = "", after = ""] = t(key, { ...params, [open]: MARK }).split(MARK);
  return { before, after };
}

// "Tidak tahu" has a label of its own only where the field words it so; any other picked answer
// must have its label, or the summary would misstate it.
function labelOf(t: Text, key: string, id: string): string {
  return t(id === "unknown" && !t.has(key) ? "common.unknown" : key);
}

// One or more lines of a stored value, in the words the reporter chose them by.
export function valueLines(t: Text, fieldId: string, value: RowValue): readonly string[] {
  switch (value.kind) {
    case "count":
      return [count.format(value.count)];
    case "text":
    case "chronology":
      return [value.text];
    case "options":
      return [
        list.format([
          ...value.optionIds.map((id) => labelOf(t, `option.${fieldId}.${id}.label`, id)),
          ...(value.otherText ? [value.otherText] : []),
        ]),
      ];
    case "hazardType":
      return [t(`hazard.${value.hazardType}.label`)];
    case "hazardSubtype": {
      return [labelOf(t, `hazardSubtype.${value.hazardType}.${value.subtype}.label`, value.subtype)];
    }
    case "eventTime": {
      const time = value.time;
      if (time.kind === "olderThan30Days") return [t("value.eventTime.olderThan30Days")];
      const date = localDateText(time.localDate);
      if (time.kind === "dateOnly") return [t("value.eventTime.dateOnly", { date })];
      return [t("value.eventTime.dateTime", { date, time: localClockText(time.localTime), zone: time.zone })];
    }
    case "place": {
      const lines = [
        t("card.placeSearch.rowVillage", { village: value.villageName }),
        t("card.placeSearch.rowPlace", {
          district: value.districtName,
          regency: value.regencyName,
          province: value.provinceName,
        }),
      ];
      // A place read from GPS says how well it is known; a village picked by search is a village.
      if (value.point === null || value.precision === "villageLevel") return lines;
      const metres = t("card.placeConfirm.accuracy", { metres: Math.round(value.point.accuracyM) });
      return [...lines, `${t(`card.placeConfirm.precision.${value.precision}`)}, ${metres}`];
    }
    default: {
      const parts = [
        value.rt === null ? null : `${t("field.neighbourhood.rt")} ${value.rt}`,
        value.rw === null ? null : `${t("field.neighbourhood.rw")} ${value.rw}`,
      ].filter((part): part is string => part !== null);
      return [list.format(parts)];
    }
  }
}

export type RowView =
  | { readonly kind: "value"; readonly text: string }
  | {
      readonly kind: "chip";
      readonly state: "none" | "confirmedUnknown" | "notYetKnown";
      readonly before: string;
    };

// "{label}: {value} {unit}" for a value; the label with an open slot for an empty state's chip.
export function rowView(t: Text, row: Row, hazardType: string | null): RowView {
  const label = t(t.variant(`field.${row.fieldId}.label`, hazardType));
  if (row.state !== "value" || row.value === null) {
    // An empty state has no unit, so nothing follows its chip.
    const { before } = splitAround(t, "card.summary.row", { label, unit: "" }, "value");
    return { kind: "chip", state: row.state === "value" ? "notYetKnown" : row.state, before };
  }
  const unitKey = row.value.kind === "count" ? unitKeyOf(row.fieldId) : null;
  const text = t("card.summary.row", {
    label,
    value: valueLines(t, row.fieldId, row.value).join(", "),
    unit: unitKey ? t(unitKey) : "",
  });
  return { kind: "value", text: text.trim() };
}

// The hazard type picked, which selects per-hazard label variants.
export function hazardOf(groups: readonly Group[]): string | null {
  for (const group of groups)
    for (const row of group.rows) if (row.value?.kind === "hazardType") return row.value.hazardType;
  return null;
}
