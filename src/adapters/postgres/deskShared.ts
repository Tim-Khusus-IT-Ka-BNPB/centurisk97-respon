import type { StaffScope } from "../../domain/deskRights";
import { empty, type Query, sql } from "../../platform/database";
import type { StaffPrincipal } from "../../ports/identity";

// What every desk query and write shares: the region an account may read, and the log of its acts.

// The region's condition, by the codes of the report's place; none for a national account.
export function regionParts(scope: StaffScope): Query[] {
  if (scope.level === "national") return [];
  return scope.level === "regency" ? [sql`r.regency_code = ${scope.code}`] : [sql`r.province_code = ${scope.code}`];
}

// The region's condition after a where clause.
export const regionCondition = (scope: StaffScope): Query =>
  regionParts(scope).reduce((joined, part) => sql`${joined} and ${part}`, empty);

type LoggedAction =
  | "view"
  | "identityView"
  | "status"
  | "reply"
  | "fieldCheck"
  | "handlingAction"
  | "handlingProof"
  | "take"
  | "document";

// A change of what no report is about.
export const staffRow = (staff: StaffPrincipal, action: "pilotAllow" | "pilotRemove", at: Date): Query =>
  sql`insert into staff_action (staff_id, staff_label, staff_kind, action, at)
    values (${staff.staffId}, ${staff.label}, ${staff.role}, ${action}, ${at})`;

export const actionRow = (staff: StaffPrincipal, ticketNumber: string, action: LoggedAction, at: Date): Query =>
  sql`insert into staff_action (ticket_number, staff_id, staff_label, staff_kind, action, at)
    values (${ticketNumber}, ${staff.staffId}, ${staff.label}, ${staff.role}, ${action}, ${at})`;
