import { REPORTS_TO_HIDE } from "../../domain/comments";
import type { Change } from "../../domain/fieldCheck";
import type { FieldStates } from "../../domain/fieldState";
import { atomically, changedOne, type Database, type Query, row, rows, sql } from "../../platform/database";
import type { StaffPrincipal } from "../../ports/identity";
import { historyNotice } from "./news";

export type ShownComment = { readonly id: string; readonly text: string; readonly createdAt: string };

// A card's comments everyone may read, oldest first.
export async function shownComments(db: Database, cardId: string): Promise<ShownComment[]> {
  const found = await rows<{ id: string; text: string; created_at: string }>(
    db,
    sql`select id, text, created_at from feed_comment where card_id = ${cardId} and status = 'shown'
      order by created_at, id limit 200`,
  );
  return found.map((one) => ({ id: one.id, text: one.text, createdAt: one.created_at }));
}

export type NewComment = {
  readonly id: string;
  readonly cardId: string;
  readonly authorKey: string;
  readonly text: string;
  readonly figures: readonly { readonly figure: string; readonly value: number; readonly quote: string }[];
};

// The comment with the figures read from it, together.
export async function addComment(db: Database, comment: NewComment, at: Date): Promise<void> {
  await atomically(db, [
    sql`insert into feed_comment (id, card_id, author_key, text, created_at)
      values (${comment.id}, ${comment.cardId}, ${comment.authorKey}, ${comment.text}, ${at})`,
    ...comment.figures.map(
      (one) => sql`insert into feed_comment_figure (comment_id, figure, value, quote)
        values (${comment.id}, ${one.figure}, ${one.value}, ${one.quote})`,
    ),
  ]);
}

export const commentById = (db: Database, id: string) =>
  row<{ id: string; card_id: string; author_key: string; status: string }>(
    db,
    sql`select id, card_id, author_key, status from feed_comment where id = ${id}`,
  );

// One report per person; the third takes a shown comment off the card. False when this person had
// reported it already.
export async function reportComment(db: Database, commentId: string, reporterKey: string, at: Date): Promise<boolean> {
  const done = await atomically(db, [
    sql`insert into feed_comment_report (comment_id, reporter_key, at) values (${commentId}, ${reporterKey}, ${at})`,
    sql`update feed_comment set reports = reports + 1,
        status = case when status = 'shown' and reports + 1 >= ${REPORTS_TO_HIDE} then 'reported' else status end
      where id = ${commentId}`,
  ]);
  return done !== null;
}

export type DeskCommentRow = {
  readonly id: string;
  readonly text: string;
  readonly status: string;
  readonly reports: number;
  readonly createdAt: string;
  // How many of its author's comments the desk has hidden anywhere (upstream Q74).
  readonly authorHidden: number;
  readonly figures: readonly {
    readonly id: number;
    readonly figure: string;
    readonly value: number;
    readonly quote: string;
    readonly status: string;
  }[];
  readonly decisions: readonly {
    readonly action: string;
    readonly fieldId: string | null;
    readonly reason: string | null;
    readonly staffLabel: string;
    readonly at: string;
  }[];
};

// Every comment of a card for the desk, with its figures and what was decided, oldest first.
export async function deskComments(db: Database, cardId: string): Promise<DeskCommentRow[]> {
  const comments = await rows<{
    id: string;
    text: string;
    status: string;
    reports: number;
    created_at: string;
    author_hidden: number;
  }>(
    db,
    sql`select c.id, c.text, c.status, c.reports, c.created_at,
        (select count(*) from feed_comment h where h.author_key = c.author_key and h.status = 'hidden') as author_hidden
      from feed_comment c where c.card_id = ${cardId} order by c.created_at, c.id limit 200`,
  );
  if (comments.length === 0) return [];
  const ids = JSON.stringify(comments.map((one) => one.id));
  const [figures, decisions] = await Promise.all([
    rows<{ id: number; comment_id: string; figure: string; value: number; quote: string; status: string }>(
      db,
      sql`select id, comment_id, figure, value, quote, status from feed_comment_figure
        where comment_id in (select value from json_each(${ids})) order by id`,
    ),
    rows<{
      comment_id: string;
      action: string;
      field_id: string | null;
      reason: string | null;
      staff_label: string;
      at: string;
    }>(
      db,
      sql`select comment_id, action, field_id, reason, staff_label, at from feed_comment_decision
        where comment_id in (select value from json_each(${ids})) order by id`,
    ),
  ]);
  return comments.map((one) => ({
    id: one.id,
    text: one.text,
    status: one.status,
    reports: one.reports,
    createdAt: one.created_at,
    authorHidden: one.author_hidden,
    figures: figures
      .filter((figure) => figure.comment_id === one.id)
      .map(({ id, figure, value, quote, status }) => ({ id, figure, value, quote, status })),
    decisions: decisions
      .filter((decision) => decision.comment_id === one.id)
      .map((decision) => ({
        action: decision.action,
        fieldId: decision.field_id,
        reason: decision.reason,
        staffLabel: decision.staff_label,
        at: decision.at,
      })),
  }));
}

type Decision = {
  readonly commentId: string;
  readonly figureId: number | null;
  readonly action: "accept" | "reject" | "hide" | "show";
  readonly ticketNumber: string | null;
  readonly fieldId: string | null;
  readonly reason: string | null;
};

const decisionRow = (staff: StaffPrincipal, decision: Decision, at: Date): Query =>
  sql`insert into feed_comment_decision (comment_id, figure_id, action, ticket_number, field_id, reason, staff_id,
      staff_label, at)
    values (${decision.commentId}, ${decision.figureId}, ${decision.action}, ${decision.ticketNumber},
      ${decision.fieldId}, ${decision.reason}, ${staff.staffId}, ${staff.label}, ${at})`;

// A comment hidden from the card or shown again. False when it is that way already.
export async function setCommentShown(
  db: Database,
  staff: StaffPrincipal,
  commentId: string,
  shown: boolean,
  reason: string | null,
  at: Date,
): Promise<boolean> {
  const to = shown ? "shown" : "hidden";
  const done = await atomically(db, [
    sql`update feed_comment set status = ${to} where id = ${commentId} and status <> ${to}`,
    changedOne,
    decisionRow(
      staff,
      { commentId, figureId: null, action: shown ? "show" : "hide", ticketNumber: null, fieldId: null, reason },
      at,
    ),
  ]);
  return done !== null;
}

export const figureById = (db: Database, id: number) =>
  row<{
    id: number;
    comment_id: string;
    card_id: string;
    figure: string;
    value: number;
    quote: string;
    status: string;
  }>(
    db,
    sql`select f.id, f.comment_id, c.card_id, f.figure, f.value, f.quote, f.status
      from feed_comment_figure f join feed_comment c on c.id = f.comment_id where f.id = ${id}`,
  );

// A proposed figure turned down. False when it was decided already.
export async function rejectFigure(
  db: Database,
  staff: StaffPrincipal,
  figure: { readonly id: number; readonly commentId: string },
  reason: string | null,
  at: Date,
): Promise<boolean> {
  const done = await atomically(db, [
    sql`update feed_comment_figure set status = 'rejected' where id = ${figure.id} and status = 'proposed'`,
    changedOne,
    decisionRow(
      staff,
      { commentId: figure.commentId, figureId: figure.id, action: "reject", ticketNumber: null, fieldId: null, reason },
      at,
    ),
  ]);
  return done !== null;
}

export type AcceptedFigure = {
  readonly figureId: number;
  readonly commentId: string;
  readonly reportId: string;
  readonly ticketNumber: string;
  readonly status: string;
  readonly revision: number;
  readonly change: Change;
  readonly quote: string;
  // The values with the figure, or null when the report holds it already.
  readonly next: { readonly states: FieldStates; readonly completePercent: number } | null;
  readonly reason: string | null;
};

const LAST = (reportId: string): Query => sql`(select max(version) from report_version where report_id = ${reportId})`;

// A proposed figure taken into the report the card reads, as a new version told in its history (D139),
// with the decision; or nothing when the figure or the ticket changed after they were read.
export async function acceptFigure(
  db: Database,
  staff: StaffPrincipal,
  accepted: AcceptedFigure,
  at: Date,
): Promise<boolean> {
  const { ticketNumber, reportId, next } = accepted;
  const decision = decisionRow(
    staff,
    {
      commentId: accepted.commentId,
      figureId: accepted.figureId,
      action: "accept",
      ticketNumber,
      fieldId: accepted.change.fieldId,
      reason: accepted.reason,
    },
    at,
  );
  const done = await atomically(db, [
    sql`update feed_comment_figure set status = 'accepted' where id = ${accepted.figureId} and status = 'proposed'`,
    changedOne,
    ...(next === null
      ? [decision]
      : [
          sql`update ticket set revision = revision + 1, updated_at = ${at}
            where ticket_number = ${ticketNumber} and revision = ${accepted.revision}`,
          changedOne,
          sql`insert into ticket_history (ticket_number, from_status, to_status, actor, actor_id, actor_label, note, at,
              event, detail)
            values (${ticketNumber}, ${accepted.status}, ${accepted.status}, 'staff', ${staff.staffId}, ${staff.label},
              ${accepted.quote}, ${at}, 'commentFigure', ${{ changes: [accepted.change] }})`,
          historyNotice(ticketNumber, "correction", at),
          sql`insert into report_version (report_id, version, fields, reporter_name, reporter_number, reporter_role,
              officer_regency, officer_position, privacy_version, consent_agreed_at, complete_percent, created_at)
            select report_id, version + 1, ${next.states}, reporter_name, reporter_number, reporter_role,
              officer_regency, officer_position, privacy_version, consent_agreed_at, ${next.completePercent}, ${at}
            from report_version where report_id = ${reportId} and version = ${LAST(reportId)}`,
          decision,
        ]),
  ]);
  return done !== null;
}
