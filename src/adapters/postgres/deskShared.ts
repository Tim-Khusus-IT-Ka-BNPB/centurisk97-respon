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
  | "document"
  | "trackingLink";

// The act, with the region the account worked in then, so a later change of its scope moves nothing.
export const actionRow = (staff: StaffPrincipal, ticketNumber: string, action: LoggedAction, at: Date): Query =>
  sql`insert into staff_action (ticket_number, staff_id, staff_label, staff_kind, action, at, staff_scope_level,
      staff_scope_code)
    values (${ticketNumber}, ${staff.staffId}, ${staff.label}, ${staff.role}, ${action}, ${at}, ${staff.scope.level},
      ${staff.scope.level === "national" ? null : staff.scope.code})`;
