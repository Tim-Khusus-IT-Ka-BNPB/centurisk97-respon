import { eventOf, releaseFromEvent } from "../adapters/postgres/events";
import { atomically } from "../platform/database";
import type { StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { changeTicket, type DeskChange } from "./desk";

// "Lepas": a report out of the event its reporter joined, by a BNPB desk officer.
export function releaseReport(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
): Promise<DeskChange> {
  return changeTicket(bindings, staff, "releaseEvent", ticketNumber, async (found, at) => {
    const event = await eventOf(bindings.db, ticketNumber);
    if (event === null) return { kind: "notFound" };
    await atomically(bindings.db, releaseFromEvent(ticketNumber, event, found.status, staff, at));
    return null;
  });
}
