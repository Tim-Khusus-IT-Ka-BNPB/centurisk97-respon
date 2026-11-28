import type { StaffScope } from "../../domain/deskRights";
import { empty, type Query, sql } from "../../platform/database";
import type { StaffPrincipal } from "../../ports/identity";

// What every desk query and write shares: the region an account may read, and the log of its acts.

// The region's condition, by the BPBD the ticket is assigned to: a regency's own, a province's
// every one in it. A ticket held for Pusdalops is no BPBD's yet. None for a national account.
export function regionParts(scope: StaffScope): Query[] {
  if (scope.level === "national") return [];
  const area =
    scope.level === "regency" ? sql`t.assigned_area = ${scope.code}` : sql`left(t.assigned_area, 2) = ${scope.code}`;
  return [area, sql`not t.held`];
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
  | "trackingLink"
  | "assign";

// The act, with the region the account worked in then, so a later change of its scope moves nothing.
export const actionRow = (staff: StaffPrincipal, ticketNumber: string, action: LoggedAction, at: Date): Query =>
  sql`insert into staff_action (ticket_number, staff_id, staff_label, staff_kind, action, at, staff_scope_level,
      staff_scope_code)
    values (${ticketNumber}, ${staff.staffId}, ${staff.label}, ${staff.role}, ${action}, ${at}, ${staff.scope.level},
      ${staff.scope.level === "national" ? null : staff.scope.code})`;
