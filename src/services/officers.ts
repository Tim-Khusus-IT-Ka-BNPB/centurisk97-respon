import { deskReport } from "../adapters/postgres/desk";
import { logOfficerNumber } from "../adapters/postgres/officers";
import type { DeskReport } from "../contract/desk";
import { mayUse } from "../domain/deskRights";
import type { PlaceValue } from "../domain/fieldState";
import { maskNumber } from "../domain/phoneNumber";
import type { StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { admitted, type DeskAnswer } from "./desk";
import { contactOf } from "./tracking";

// The BPBD officers of a report's region for a BNPB officer (upstream PF-09), numbers masked; with
// no officer of the regency, the BPBD's own number from its contact file. Null for anyone else.
export async function officersOf(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  villageCode: string,
  place: Pick<PlaceValue, "villageCode" | "regencyName" | "provinceName">,
): Promise<DeskReport["officers"]> {
  if (!mayUse(staff.role, "callOfficers")) return null;
  const officers = await bindings.identity.officers(villageCode);
  return {
    items: officers.map(({ number, id, ...officer }) => ({ ...officer, profileId: id, masked: maskNumber(number) })),
    official: officers.some((officer) => officer.level === "regency") ? null : await contactOf(bindings, place),
  };
}

// One officer's full number, opened from a report and logged each time.
export async function officerNumber(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
  profileId: string,
): Promise<DeskAnswer<{ profileId: string; number: string }>> {
  const refused = await admitted(bindings, staff, "callOfficers", "desk.write");
  if (refused) return refused;
  const found = await deskReport(bindings.db, staff.scope, ticketNumber);
  if (found === null) return { kind: "notFound" };
  const officer = (await bindings.identity.officers(found.villageCode)).find((one) => one.id === profileId);
  if (officer === undefined) return { kind: "notFound" };
  await logOfficerNumber(bindings.db, staff, ticketNumber, profileId, new Date(bindings.clock.now()));
  return { kind: "ok", body: { profileId, number: officer.number } };
}
