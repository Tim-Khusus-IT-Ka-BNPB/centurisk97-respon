import { pullToday, todayOf } from "../adapters/d1/today";
import { shownToday, todayConditions, verifiedAtMs } from "../domain/todayPage";
import type { StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { changeTicket, type DeskChange } from "./desk";

// The report's five conditions for the today page, for the desk's list (upstream LK-07); null while
// the page is shut.
export async function todayFor(bindings: ServiceBindings, ticketNumber: string) {
  if (!bindings.settings.todayPage) return null;
  const row = await todayOf(bindings.db, ticketNumber);
  return { conditions: { ...todayConditions(row) }, shown: shownToday(verifiedAtMs(row), bindings.clock.now()) };
}

// An event pulled off the today page, or put back, by BNPB or the region's BPBD (upstream D8).
export function setTodayPull(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
  pulled: boolean,
): Promise<DeskChange> {
  return changeTicket(bindings, staff, "pullToday", ticketNumber, async (_found, at) => {
    if (!bindings.settings.todayPage) return { kind: "notFound" };
    await pullToday(bindings.db, staff, ticketNumber, pulled, at);
    return null;
  });
}
