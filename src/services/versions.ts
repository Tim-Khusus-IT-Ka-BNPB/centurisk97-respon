import { reportVersions } from "../adapters/d1/versions";
import type { ReportVersion } from "../contract/ownReport";
import type { ServiceBindings } from "./bindings";
import { at, draftZone } from "./draftView";
import { changeRows } from "./summary";

// Every version of a report, the newest first, each with what it changed.
export async function versionsOf(
  bindings: ServiceBindings,
  ticketNumber: string,
  villageCode: string,
): Promise<ReportVersion[]> {
  const zone = draftZone(villageCode);
  const found = await reportVersions(bindings.db, ticketNumber);
  return found
    .map((one, index) => {
      const before = found[index - 1]?.states;
      return {
        version: one.version,
        at: at(one.createdAt, zone),
        madeBy: one.madeBy,
        changes: before === undefined ? [] : changeRows(before, one.states),
      };
    })
    .toReversed();
}
