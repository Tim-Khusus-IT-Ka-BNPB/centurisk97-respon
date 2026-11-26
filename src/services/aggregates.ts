import { type AggregateRowData, aggregateReports, logAggregateDownload } from "../adapters/d1/aggregates";
import { copy } from "../copy";
import { hazardKey } from "../copy/hazardKey";
import { type AggregateInput, type AggregateRow, aggregateRows, toCsv } from "../domain/aggregates";
import { eventInstantMs, localDate } from "../domain/eventTime";
import type { EventTimeValue, PlaceValue } from "../domain/fieldState";
import { parsed } from "../platform/database";
import type { StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { admitted, type DeskAnswer } from "./desk";

type States = Record<string, { readonly state: string; readonly value?: unknown }>;

const COLUMNS = [
  "week",
  "provinceCode",
  "provinceName",
  "regencyCode",
  "regencyName",
  "hazardType",
  "reports",
  "reporters",
  "placedPhotos",
  "invalid",
  "medianMinutesToReport",
] as const satisfies readonly (keyof AggregateRow)[];

export function inputOf(row: AggregateRowData): AggregateInput {
  const states = parsed<States>(row.fields) as States;
  const place = states.place?.value as PlaceValue;
  const eventTime = states.eventTime?.state === "value" ? (states.eventTime.value as EventTimeValue) : null;
  return {
    provinceCode: row.province_code,
    provinceName: place.provinceName,
    regencyCode: row.regency_code,
    regencyName: place.regencyName,
    hazardType: row.hazard_type,
    eventMs: eventTime === null ? null : eventInstantMs(eventTime),
    sentMs: Date.parse(row.sent_at),
    numberKey: row.number_key,
    placedPhoto: row.placed_photo === 1,
    status: row.status,
  };
}

export type AggregateFile = { readonly bytes: Uint8Array; readonly mime: string; readonly name: string };

// The weekly counts as a CSV file. Each download is logged (D93); nothing in it names a person, a
// ticket or a village.
export async function aggregatesFile(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
): Promise<DeskAnswer<AggregateFile>> {
  const refused = await admitted(bindings, staff, "downloadAggregates", "desk.write");
  if (refused) return refused;
  const rows = aggregateRows((await aggregateReports(bindings.db)).map(inputOf));
  const csv = toCsv(
    COLUMNS.map((column) => copy.text(`aggregate.column.${column}`)),
    rows.map((row) =>
      COLUMNS.map((column) => (column === "hazardType" ? copy.text(hazardKey(row[column])) : row[column])),
    ),
  );
  const now = bindings.clock.now();
  await logAggregateDownload(bindings.db, staff, new Date(now));
  return {
    kind: "ok",
    body: {
      bytes: new TextEncoder().encode(csv),
      mime: "text/csv; charset=utf-8",
      name: copy.format("aggregate.fileName", { date: localDate(now, "WIB") }),
    },
  };
}
