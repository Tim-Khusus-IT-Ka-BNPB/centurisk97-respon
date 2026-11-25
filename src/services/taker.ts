import { deskReport } from "../adapters/d1/desk";
import { responseRows, takeReport } from "../adapters/d1/taker";
import type { DeskResponse } from "../contract/desk";
import { monthSpan, responseByAgency } from "../domain/response";
import type { OfficerProfile, StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { admitted, changeTicket, type DeskAnswer, type DeskChange, ENDED } from "./desk";

// "Ditangani: Uji Andi, Pusdalops BPBD Kabupaten Uji Satu" is drawn from this.
const takerLabel = ({ name, position, agency }: OfficerProfile) => `${name}, ${position} ${agency}`;

// A BPBD officer takes a report of their region in hand, once. The ticket stays where it is.
export async function takeDeskReport(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
): Promise<DeskChange> {
  return changeTicket(bindings, staff, "takeReport", ticketNumber, async (found, at) => {
    const { profile } = staff;
    if (profile === null) return { kind: "notAllowed" };
    if (found.taker !== null) return { kind: "taken", label: found.taker };
    if (ENDED.includes(found.status)) return { kind: "transitionRefused" };
    const taker = { ticketNumber, profileId: profile.id, label: takerLabel(profile), status: found.status };
    if (await takeReport(bindings.db, staff, taker, at)) return null;
    const now = await deskReport(bindings.db, staff.scope, ticketNumber);
    const label = now?.taker ?? null;
    return label === null ? { kind: "transitionRefused" } : { kind: "taken", label };
  });
}

export async function deskResponse(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  month: string,
): Promise<DeskAnswer<DeskResponse> | { readonly kind: "badMonth" }> {
  const refused = await admitted(bindings, staff, "readResponse", "desk.read");
  if (refused) return refused;
  const span = monthSpan(month);
  if (span === null) return { kind: "badMonth" };
  const rows = await responseRows(bindings.db, new Date(span.fromMs), new Date(span.toMs));
  const names = new Map(rows.map((row) => [row.regencyCode, row.regencyName]));
  const agencies = responseByAgency(rows).map((agency) => ({
    ...agency,
    regencyName: names.get(agency.regencyCode) as string,
  }));
  return {
    kind: "ok",
    body: {
      account: { label: staff.label },
      month,
      agencies: agencies.sort((a, b) => a.regencyName.localeCompare(b.regencyName, "id")),
    },
  };
}
