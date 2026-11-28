import { allowNumber, isAllowed, pilotNumbers, removeNumber } from "../adapters/postgres/pilot";
import type { DeskPilot } from "../contract/desk";
import type { FieldError } from "../domain/identityForm";
import { checkPilotNumber, PILOT_MAX } from "../domain/pilot";
import { hmacKey } from "../platform/keys";
import type { StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { admitted, type DeskAnswer } from "./desk";
import { at } from "./draftView";

const keyOf = (bindings: ServiceBindings, number: string) => hmacKey(bindings.settings.keyHmacSecret, "number", number);

async function pilotBody(bindings: ServiceBindings, staff: StaffPrincipal): Promise<DeskPilot> {
  const found = await pilotNumbers(bindings.db);
  return {
    account: { label: staff.label },
    max: PILOT_MAX,
    items: found.map((one) => ({
      key: one.numberKey,
      number: one.number,
      officerRegency: one.officerRegency,
      addedBy: one.addedBy,
      addedAt: at(one.addedAt, "WIB"),
      reports: one.reports,
      lastReportAt: one.lastReportAt === null ? null : at(one.lastReportAt, "WIB"),
    })),
  };
}

export async function deskPilot(bindings: ServiceBindings, staff: StaffPrincipal): Promise<DeskAnswer<DeskPilot>> {
  const refused = await admitted(bindings, staff, "managePilot", "desk.read");
  return refused ?? { kind: "ok", body: await pilotBody(bindings, staff) };
}

export type PilotChange = DeskAnswer<DeskPilot> | { readonly kind: "invalid"; readonly errors: readonly FieldError[] };

const onNumber = (rule: string): PilotChange => ({
  kind: "invalid",
  errors: [{ fieldId: "number", rule: `pilot.${rule}`, params: { max: PILOT_MAX } }],
});

export async function allowOnDesk(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  typed: { readonly number: string; readonly officerRegency: string },
): Promise<PilotChange> {
  const refused = await admitted(bindings, staff, "managePilot", "desk.write");
  if (refused) return refused;
  const checked = checkPilotNumber(typed.number, typed.officerRegency);
  if ("errors" in checked) return { kind: "invalid", errors: checked.errors };
  const key = await keyOf(bindings, checked.number);
  if (await isAllowed(bindings.db, key)) return onNumber("exists");
  const added = await allowNumber(bindings.db, key, checked, staff, new Date(bindings.clock.now()));
  return added ? { kind: "ok", body: await pilotBody(bindings, staff) } : onNumber("full");
}

export async function removeOnDesk(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  key: string,
): Promise<DeskAnswer<DeskPilot>> {
  const refused = await admitted(bindings, staff, "managePilot", "desk.write");
  if (refused) return refused;
  await removeNumber(bindings.db, key, staff, new Date(bindings.clock.now()));
  return { kind: "ok", body: await pilotBody(bindings, staff) };
}
