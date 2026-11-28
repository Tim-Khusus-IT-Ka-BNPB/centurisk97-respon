import { activeSnapshot, areaOf } from "../adapters/postgres/places";
import {
  keepChoice,
  latestPause,
  setPause,
  stopWarnings,
  subscriberCount,
  subscriptionsOf,
  type WarningChoice,
} from "../adapters/postgres/warnings";
import type { WarningControl } from "../contract/warnings";
import { MAX_SUBSCRIBERS } from "../domain/warnings";
import type { StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { admitted, type DeskAnswer } from "./desk";
import { checkLimits, type LimitRefusal } from "./limits";

export type WarningView = {
  readonly districts: { code: string; name: string }[];
  readonly hazards: number | null;
  readonly threshold: number | null;
};

export type WarningAnswer =
  | { readonly kind: "kept"; readonly view: WarningView }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal }
  // No push keys, or no places to read the districts from.
  | { readonly kind: "closed" }
  | { readonly kind: "full" }
  | { readonly kind: "unknownDistrict" };

type Choice = Omit<WarningChoice, "districts"> & { readonly districts: readonly string[] };

const limited = (bindings: ServiceBindings, address: string) =>
  checkLimits(bindings, [["address.warnings", { kind: "address", bucket: address }]]);

// What this phone is warned of; no districts when it is warned of nothing.
export async function warningsOf(bindings: ServiceBindings, endpoint: string): Promise<WarningView> {
  const found = await subscriptionsOf(bindings.db, endpoint);
  return {
    districts: found.map((one) => ({ code: one.district_code, name: one.district_name })),
    hazards: found[0]?.hazards ?? null,
    threshold: found[0]?.threshold ?? null,
  };
}

// A phone's choice, whole: a new phone, or a change of the districts, the hazards or the level.
export async function chooseWarnings(
  bindings: ServiceBindings,
  address: string,
  choice: Choice,
): Promise<WarningAnswer> {
  const refusal = await limited(bindings, address);
  if (refusal) return { kind: "limit", refusal };
  const snapshot = await activeSnapshot(bindings.db);
  if (bindings.settings.push === null || snapshot === null) return { kind: "closed" };
  const districts = [];
  for (const code of choice.districts) {
    const area = await areaOf(bindings.db, snapshot.id, "district", code);
    if (area === null) return { kind: "unknownDistrict" };
    districts.push({ code, name: area.name });
  }
  const before = await subscriptionsOf(bindings.db, choice.endpoint);
  if (before.length === 0 && (await subscriberCount(bindings.db)) >= MAX_SUBSCRIBERS) return { kind: "full" };
  await keepChoice(bindings.db, { ...choice, districts }, new Date(bindings.clock.now()));
  return { kind: "kept", view: { districts, hazards: choice.hazards, threshold: choice.threshold } };
}

export async function stopChoice(
  bindings: ServiceBindings,
  address: string,
  endpoint: string,
): Promise<LimitRefusal | null> {
  const refusal = await limited(bindings, address);
  if (refusal === null) await stopWarnings(bindings.db, endpoint);
  return refusal;
}

// The desk's pause (M07 gate): with a change, the newest row from now on; the sender reads it each run.
export async function warningControl(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  paused: boolean | null,
): Promise<DeskAnswer<WarningControl>> {
  const refused = await admitted(bindings, staff, "pauseWarnings", paused === null ? "desk.read" : "desk.write");
  if (refused) return refused;
  if (paused !== null) await setPause(bindings.db, paused, staff, new Date(bindings.clock.now()));
  const latest = await latestPause(bindings.db);
  return {
    kind: "ok",
    body: {
      open: bindings.settings.push !== null,
      paused: latest?.paused === true,
      by: latest?.staff_label ?? null,
      at: latest?.at ?? null,
      phones: await subscriberCount(bindings.db),
    },
  };
}
