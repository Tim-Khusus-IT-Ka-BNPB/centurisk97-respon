import { type AreaChoice, areaChoices, areaName, assignTicket } from "../adapters/postgres/assignment";
import { deskReport } from "../adapters/postgres/desk";
import type { StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { admitted, changeTicket, type DeskAnswer, type DeskChange, ENDED } from "./desk";

const AREA = /^\d{2}(\.\d{2})?$/;

// The areas a ticket can be given to, for Pusdalops.
export async function deskAreas(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
): Promise<DeskAnswer<{ readonly areas: readonly AreaChoice[] }>> {
  const refused = await admitted(bindings, staff, "forwardTicket", "desk.read");
  if (refused) return refused;
  return { kind: "ok", body: { areas: await areaChoices(bindings.db) } };
}

// Pusdalops gives an open ticket to a BPBD, a regency's or a province's, or releases it from its
// hold to the one it has: that BPBD sees it from now on. The reporter is told nothing of it.
export async function assignDeskTicket(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
  assign: { readonly area: string; readonly revision: number },
): Promise<DeskChange> {
  return changeTicket(bindings, staff, "forwardTicket", ticketNumber, async (found, at) => {
    if (found.revision !== assign.revision) return { kind: "changed", status: found.status };
    if (ENDED.includes(found.status)) return { kind: "transitionRefused" };
    const name = AREA.test(assign.area) ? await areaName(bindings.db, assign.area) : null;
    if (name === null) return { kind: "invalid", error: { fieldId: "area", rule: "area.unknown", params: {} } };
    const ticket = { number: ticketNumber, revision: assign.revision, area: assign.area, name };
    if (await assignTicket(bindings.db, staff, ticket, at)) return null;
    const now = (await deskReport(bindings.db, staff.scope, ticketNumber)) as { readonly status: typeof found.status };
    return { kind: "changed", status: now.status };
  });
}
