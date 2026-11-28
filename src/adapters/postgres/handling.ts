import type { StaffScope } from "../../domain/deskRights";
import type { Change, CheckResult } from "../../domain/fieldCheck";
import type { FieldStates } from "../../domain/fieldState";
import { PROOF, type TakenAction } from "../../domain/handling";
import type { DeviceFix } from "../../domain/photoChecks";
import type { TicketStatus } from "../../domain/stages";
import { atomically, changedOne, type Database, holds, type Query, row, rows, sql } from "../../platform/database";
import type { StaffPrincipal } from "../../ports/identity";
import { actionRow, regionCondition } from "./deskShared";
import { historyNotice } from "./news";

export type Handling = {
  readonly actions: readonly { readonly label: string; readonly atMs: number; readonly staffLabel: string }[];
  readonly proofs: readonly {
    readonly id: string;
    readonly hasPoint: boolean;
    readonly atMs: number;
    readonly staffLabel: string;
    // Shown on the public feed while its report is handled (D88).
    readonly public: boolean;
    // Sent on to the officer, not taken by them; never on the public feed.
    readonly forwarded: boolean;
  }[];
};

// What was done about a report, oldest first.
export async function handlingOf(db: Database, ticketNumber: string): Promise<Handling> {
  const [actions, proofs] = await Promise.all([
    rows<{ label: string; staff_label: string; at: string }>(
      db,
      sql`select label, staff_label, at from handling_action where ticket_number = ${ticketNumber} order by id`,
    ),
    rows<{
      id: string;
      lat: number | null;
      staff_label: string;
      received_at: string;
      public: boolean | null;
      forwarded: boolean;
    }>(
      db,
      sql`select p.id, p.lat, p.staff_label, p.received_at, p.forwarded,
          (select u.public from proof_publication u where u.proof_id = p.id order by u.id desc limit 1) as public
        from handling_proof p where p.ticket_number = ${ticketNumber}
        order by p.received_at, p.id`,
    ),
  ]);
  return {
    actions: actions.map((one) => ({ label: one.label, atMs: Date.parse(one.at), staffLabel: one.staff_label })),
    proofs: proofs.map((one) => ({
      id: one.id,
      hasPoint: one.lat !== null,
      atMs: Date.parse(one.received_at),
      staffLabel: one.staff_label,
      public: one.public === true,
      forwarded: one.forwarded,
    })),
  };
}

type NewCheck = {
  readonly reportId: string;
  readonly result: CheckResult;
  readonly note: string;
  readonly changes: readonly Change[];
  // The values after a correction, or null when nothing changed.
  readonly next: { readonly states: FieldStates; readonly completePercent: number } | null;
  readonly from: TicketStatus;
  readonly to: TicketStatus;
  readonly revision: number;
};

const LAST = (reportId: string): Query => sql`(select max(version) from report_version where report_id = ${reportId})`;

// The check, the version it made, the history row and the log together, or nothing: false when
// another officer changed the ticket after this one read it.
export async function addFieldCheck(
  db: Database,
  staff: StaffPrincipal,
  ticketNumber: string,
  check: NewCheck,
  at: Date,
): Promise<boolean> {
  const { reportId, next } = check;
  const done = await atomically(db, [
    sql`update ticket set status = ${check.to}, revision = revision + 1, updated_at = ${at}
      where ticket_number = ${ticketNumber} and revision = ${check.revision}`,
    changedOne,
    sql`insert into ticket_history (ticket_number, from_status, to_status, actor, actor_id, actor_label, note, at, event, detail)
      values (${ticketNumber}, ${check.from}, ${check.to}, 'staff', ${staff.staffId}, ${staff.label}, ${check.note}, ${at},
        'fieldCheck', ${{ result: check.result, changes: check.changes }})`,
    ...(check.to === check.from ? [] : [historyNotice(ticketNumber, "status", at)]),
    ...(next === null ? [] : [historyNotice(ticketNumber, "correction", at)]),
    ...(next === null
      ? []
      : [
          sql`insert into report_version (report_id, version, fields, reporter_name, reporter_number, reporter_role,
              officer_regency, officer_position, privacy_version, consent_agreed_at, complete_percent, created_at)
            select report_id, version + 1, ${next.states}, reporter_name, reporter_number, reporter_role,
              officer_regency, officer_position, privacy_version, consent_agreed_at, ${next.completePercent}, ${at}
            from report_version where report_id = ${reportId} and version = ${LAST(reportId)}`,
        ]),
    sql`insert into field_check (ticket_number, staff_id, staff_label, result, note, version, at, checker_role,
        checker_level, checker_code)
      values (${ticketNumber}, ${staff.staffId}, ${staff.label}, ${check.result}, ${check.note},
        ${next === null ? null : LAST(reportId)}, ${at}, ${staff.role}, ${staff.scope.level},
        ${staff.scope.level === "national" ? null : staff.scope.code})`,
    actionRow(staff, ticketNumber, "fieldCheck", at),
  ]);
  return done !== null;
}

// What was done, as a history row at the status the ticket is in.
export const historyEvent = (
  staff: StaffPrincipal,
  ticketNumber: string,
  status: TicketStatus,
  actions: readonly TakenAction[],
  at: Date,
): Query =>
  sql`insert into ticket_history (ticket_number, from_status, to_status, actor, actor_id, actor_label, at, event, detail)
    values (${ticketNumber}, ${status}, ${status}, 'staff', ${staff.staffId}, ${staff.label}, ${at},
      'actions', ${{ actions: actions.map((action) => action.label) }})`;

// One row per action; one already there is left as it was.
export const actionRows = (
  staff: StaffPrincipal,
  ticketNumber: string,
  actions: readonly TakenAction[],
  at: Date,
): Query[] => [
  ...actions.map(
    ({ code, label }) =>
      sql`insert into handling_action (ticket_number, code, label, staff_id, staff_label, at)
        values (${ticketNumber}, ${code}, ${label}, ${staff.staffId}, ${staff.label}, ${at})
        on conflict (ticket_number, label) do nothing`,
  ),
  actionRow(staff, ticketNumber, "handlingAction", at),
];

// More done while a report is being handled; false when it no longer is.
export async function addActions(
  db: Database,
  staff: StaffPrincipal,
  ticketNumber: string,
  actions: readonly TakenAction[],
  at: Date,
): Promise<boolean> {
  const done = await atomically(db, [
    holds(sql`exists (select 1 from ticket where ticket_number = ${ticketNumber} and status = 'in_handling')`),
    historyEvent(staff, ticketNumber, "in_handling", actions, at),
    historyNotice(ticketNumber, "actions", at),
    ...actionRows(staff, ticketNumber, actions, at),
  ]);
  return done !== null;
}

export type NewProof = {
  readonly id: string;
  readonly storeKey: string;
  readonly bytes: number;
  readonly fix: DeviceFix | null;
  readonly forwarded: boolean;
};

// A photo of the work and its log; false when the report has all it may hold.
export async function addProof(
  db: Database,
  staff: StaffPrincipal,
  ticketNumber: string,
  proof: NewProof,
  at: Date,
): Promise<boolean> {
  const done = await atomically(db, [
    holds(sql`(select count(*) from handling_proof where ticket_number = ${ticketNumber}) < ${PROOF.max}`),
    sql`insert into handling_proof (id, ticket_number, store_key, bytes, lat, lon, accuracy_m, staff_id, staff_label,
        received_at, forwarded)
      values (${proof.id}, ${ticketNumber}, ${proof.storeKey}, ${proof.bytes}, ${proof.fix?.lat ?? null},
        ${proof.fix?.lon ?? null}, ${proof.fix?.accuracyM ?? null}, ${staff.staffId}, ${staff.label}, ${at},
        ${proof.forwarded})`,
    actionRow(staff, ticketNumber, "handlingProof", at),
  ]);
  return done !== null;
}

// Where a photo of the work is kept, for staff whose region holds its report.
export async function proofKey(db: Database, scope: StaffScope, proofId: string): Promise<string | null> {
  const found = await row<{ store_key: string }>(
    db,
    sql`select p.store_key from handling_proof p join report r on r.ticket_number = p.ticket_number
      join ticket t on t.ticket_number = p.ticket_number
      where p.id = ${proofId}${regionCondition(scope)}`,
  );
  return found?.store_key ?? null;
}

// The same for the report's own tracking page, once it is closed.
export async function closedProofKey(db: Database, ticketNumber: string, proofId: string): Promise<string | null> {
  const found = await row<{ store_key: string }>(
    db,
    sql`select p.store_key from handling_proof p join ticket t on t.ticket_number = p.ticket_number
      where p.id = ${proofId} and p.ticket_number = ${ticketNumber} and t.status = 'closed'`,
  );
  return found?.store_key ?? null;
}
