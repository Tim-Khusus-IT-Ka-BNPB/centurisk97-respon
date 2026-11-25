import { reportVersions } from "../adapters/d1/versions";
import type { ReportVersion } from "../contract/ownReport";
import type { FieldStates } from "../domain/fieldState";
import { type FieldId, fieldById } from "../domain/fields/catalogue";
import { versionChanges } from "../domain/versions";
import type { ServiceBindings } from "./bindings";
import { at, draftZone } from "./draftView";
import { summaryRow } from "./summary";

const rowOf = (states: FieldStates, fieldId: FieldId) => summaryRow(states, fieldById(fieldId));

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
        changes:
          before === undefined
            ? []
            : versionChanges(before, one.states).map(({ fieldId }) => ({
                fieldId,
                from: rowOf(before, fieldId),
                to: rowOf(one.states, fieldId),
              })),
      };
    })
    .toReversed();
}
