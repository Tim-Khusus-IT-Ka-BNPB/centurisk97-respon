import { type TodayRow, todayCandidates } from "../adapters/d1/today";
import type { Today } from "../contract/today";
import type { EventTimeValue, PlaceValue } from "../domain/fieldState";
import { impactOf } from "../domain/impact";
import {
  impactRanges,
  lastCheck,
  shownToday,
  TODAY_WINDOW_MS,
  type TodayCheck,
  todayConditions,
  toTheHour,
  verifiedAtMs,
} from "../domain/todayPage";
import { parsed } from "../platform/database";
import { hmacKey } from "../platform/keys";
import type { ServiceBindings } from "./bindings";
import { clusterMap } from "./clusters";
import { at, draftZone } from "./draftView";
import { checkLimits, type LimitRefusal } from "./limits";

const SHOWN = 100;
// Everyone sees the same page, so one read serves a data centre's readers for a minute (upstream D7).
const TODAY_SECONDS = 60;

export type TodayFilter = { readonly provinceCode: string | null; readonly hazardType: string | null };

export type TodayAnswer =
  | { readonly kind: "closed" }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal }
  | { readonly kind: "ok"; readonly today: Today };

type States = Record<string, { readonly state: string; readonly value?: unknown }>;
const stateValue = <T>(states: States, field: string): T | null =>
  states[field]?.state === "value" ? (states[field]?.value as T) : null;

type Verified = { readonly row: TodayRow; readonly states: States; readonly atMs: number };

const rounded = (degrees: number) => Math.round(degrees * 1e4) / 1e4;

// One event's card from its verified reports only: the latest names the place and the kind, the
// earliest the time, the latest verification its checker.
async function cardOf(bindings: ServiceBindings, members: readonly Verified[]): Promise<Today["events"][number]> {
  const bySent = members.toSorted((a, b) => a.row.sentAt.localeCompare(b.row.sentAt));
  const [first, latest] = [bySent[0] as Verified, bySent.at(-1) as Verified];
  const verified = members.toSorted((a, b) => a.atMs - b.atMs).at(-1) as Verified;
  const check = lastCheck(verified.row.checks) as TodayCheck;
  const place = stateValue<PlaceValue>(latest.states, "place") as PlaceValue;
  const subtype = stateValue<string>(latest.states, "hazardSubtype");
  const reporters = new Set(members.map((one) => one.row.numberKey)).size;
  return {
    id: (await hmacKey(bindings.settings.keyHmacSecret, "today", first.row.reportId)).slice(0, 10),
    hazardType: latest.row.hazardType as Today["events"][number]["hazardType"],
    hazardSubtype: subtype === "unknown" ? null : subtype,
    eventTime: toTheHour(stateValue<EventTimeValue>(first.states, "eventTime")),
    place: {
      villageName: place.villageName,
      districtName: place.districtName,
      regencyName: place.regencyName,
      provinceName: place.provinceName,
    },
    centre: latest.row.centre && { lat: rounded(latest.row.centre.lat), lon: rounded(latest.row.centre.lon) },
    reporters: reporters >= 2 ? reporters : null,
    verifiedBy:
      check.level === "province"
        ? { level: "province", name: place.provinceName }
        : { level: "regency", name: place.regencyName },
    verifiedAt: at(verified.atMs, draftZone(place.villageCode)),
    impact: impactRanges(members.map((one) => impactOf(one.states))),
  };
}

// The events verified by their region's BPBD in the last 24 hours, newest verification first; one
// card per event, from its verified reports alone. Off unless the switch is on (upstream D12).
export async function todayView(bindings: ServiceBindings, address: string, filter: TodayFilter): Promise<TodayAnswer> {
  if (!bindings.settings.todayPage) return { kind: "closed" };
  const refusal = await checkLimits(bindings, [["address.feed", { kind: "address", bucket: address }]]);
  if (refusal) return { kind: "limit", refusal };
  const key = `today?province=${filter.provinceCode ?? ""}&hazard=${filter.hazardType ?? ""}`;
  const kept = await bindings.edge.get(key);
  if (kept !== null) return { kind: "ok", today: JSON.parse(kept) as Today };
  const nowMs = bindings.clock.now();
  const [rows, clusterOf] = await Promise.all([
    todayCandidates(bindings.db, new Date(nowMs - TODAY_WINDOW_MS)),
    clusterMap(bindings),
  ]);
  // A pull is the event's: one report pulled takes its whole event off (upstream D8).
  const events = await Promise.all(
    [...Map.groupBy(rows, (row) => clusterOf.get(row.ticketNumber)?.tickets[0] ?? row.ticketNumber).values()]
      .filter((group) => group.every((row) => todayConditions(row).pull))
      .flatMap((group) => {
        const members = group.flatMap((row) => {
          const atMs = verifiedAtMs(row);
          return shownToday(atMs, nowMs)
            ? [{ row, states: parsed<States>(row.fields) as States, atMs: atMs as number }]
            : [];
        });
        return members.length === 0 ? [] : [members];
      })
      .map((members) => ({ members, atMs: Math.max(...members.map((one) => one.atMs)) }))
      .filter(({ members }) => {
        const latest = members.toSorted((a, b) => b.row.sentAt.localeCompare(a.row.sentAt))[0] as Verified;
        return (
          (filter.provinceCode === null || latest.row.villageCode.startsWith(`${filter.provinceCode}.`)) &&
          (filter.hazardType === null || latest.row.hazardType === filter.hazardType)
        );
      })
      .sort((a, b) => b.atMs - a.atMs)
      .slice(0, SHOWN)
      .map(({ members }) => cardOf(bindings, members)),
  );
  const today = { events };
  await bindings.edge.put(key, JSON.stringify(today), TODAY_SECONDS);
  return { kind: "ok", today };
}
