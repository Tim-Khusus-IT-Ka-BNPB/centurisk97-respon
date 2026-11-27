import {
  acceptFigure,
  addComment,
  commentById,
  deskComments,
  figureById,
  rejectFigure,
  reportComment,
  setCommentShown,
  shownComments,
} from "../adapters/d1/comments";
import { deskReport } from "../adapters/d1/desk";
import { knownProfiles } from "../adapters/d1/reporters";
import type { Comments, DeskComments } from "../contract/comments";
import {
  COMMENT_SCHEMA,
  COMMENT_SYSTEM,
  type CommentFigure,
  cleanComment,
  figuresFrom,
  mayHoldFigures,
  type ProposedFigure,
} from "../domain/comments";
import { type Change, revisableOf, revised } from "../domain/fieldCheck";
import type { FieldStates } from "../domain/fieldState";
import { hmacKey } from "../platform/keys";
import type { Principal, StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { changeTicket, type DeskChange, ENDED } from "./desk";
import { at } from "./draftView";
import { checkLimits, type LimitRefusal } from "./limits";
import { shownCards } from "./publicFeed";

type Reporter = Extract<Principal, { kind: "device" | "session" }>;

// The model is stopped before the comment waits too long; with no answer the comment has no figures.
const MODEL_DEADLINE_MS = 4500;
const MINUTE_MS = 60_000;

// Shown to everyone to the minute only, in WIB.
const minuteOf = (iso: string) => at(Math.floor(Date.parse(iso) / MINUTE_MS) * MINUTE_MS, "WIB");

export type CommentsAnswer =
  | { readonly kind: "ok"; readonly comments: Comments }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// A card's comments as everyone reads them: the words and the minute, never who wrote them.
export async function cardComments(
  bindings: ServiceBindings,
  address: string,
  cardId: string,
): Promise<CommentsAnswer> {
  const refusal = await checkLimits(bindings, [["address.feed", { kind: "address", bucket: address }]]);
  if (refusal) return { kind: "limit", refusal };
  const found = await shownComments(bindings.db, cardId);
  return {
    kind: "ok",
    comments: { comments: found.map((one) => ({ id: one.id, text: one.text, at: minuteOf(one.createdAt) })) },
  };
}

const profileOf = async (bindings: ServiceBindings, principal: Reporter) =>
  (
    await knownProfiles(
      bindings.db,
      principal.kind === "device" ? { deviceId: principal.deviceId } : { reporterId: principal.reporterId },
      new Date(bindings.clock.now()),
    )
  )[0] ?? null;

async function modelFigures(bindings: ServiceBindings, text: string): Promise<ProposedFigure[]> {
  if (bindings.settings.model.mode === "off" || !mayHoldFigures(text)) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), MODEL_DEADLINE_MS);
  });
  const asked = bindings.model
    .extract(
      { system: COMMENT_SYSTEM, user: `<comment>\n${text}\n</comment>`, schema: COMMENT_SCHEMA },
      AbortSignal.timeout(MODEL_DEADLINE_MS),
    )
    .catch(() => null);
  try {
    return figuresFrom(await Promise.race([asked, late]), text);
  } finally {
    clearTimeout(timer);
  }
}

export type PostAnswer =
  | { readonly kind: "ok"; readonly comment: Comments["comments"][number] }
  | { readonly kind: "unknownReporter" }
  | { readonly kind: "notShown" }
  | { readonly kind: "invalid"; readonly rule: string }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// A comment on a card the Alun-alun shows now, by a reporter known on this phone or in this session
// (D136). The figures it states are read by the model as proposals the desk decides on (D138).
export async function postComment(
  bindings: ServiceBindings,
  principal: Reporter,
  address: string,
  cardId: string,
  typed: string,
): Promise<PostAnswer> {
  const byAddress = await checkLimits(bindings, [["address.comments", { kind: "address", bucket: address }]]);
  if (byAddress) return { kind: "limit", refusal: byAddress };
  const profile = await profileOf(bindings, principal);
  if (profile === null) return { kind: "unknownReporter" };
  const cleaned = cleanComment(typed);
  if (cleaned.kind === "refused") return { kind: "invalid", rule: `comment.${cleaned.rule}` };
  if (!(await shownCards(bindings)).some((card) => card.cardId === cardId)) return { kind: "notShown" };
  const byNumber = await checkLimits(bindings, [
    ["comment.hour", { kind: "numberSlot", numberKey: profile.number_key, ownerSlot: profile.owner_slot }],
  ]);
  if (byNumber) return { kind: "limit", refusal: byNumber };
  const id = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const now = new Date(bindings.clock.now());
  const figures = await modelFigures(bindings, cleaned.text);
  await addComment(bindings.db, { id, cardId, authorKey: profile.number_key, text: cleaned.text, figures }, now);
  return { kind: "ok", comment: { id, text: cleaned.text, at: minuteOf(now.toISOString()) } };
}

export type ReportAnswer =
  | { readonly kind: "ok"; readonly counted: boolean }
  | { readonly kind: "unknownReporter" }
  | { readonly kind: "notFound" }
  | { readonly kind: "own" }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// A comment reported by someone who may comment, not its author. A phone's numbers count once for its
// network, since one phone may type many (D137).
export async function reportCardComment(
  bindings: ServiceBindings,
  principal: Reporter,
  address: string,
  commentId: string,
): Promise<ReportAnswer> {
  const byAddress = await checkLimits(bindings, [["address.commentReports", { kind: "address", bucket: address }]]);
  if (byAddress) return { kind: "limit", refusal: byAddress };
  const profile = await profileOf(bindings, principal);
  if (profile === null) return { kind: "unknownReporter" };
  const comment = await commentById(bindings.db, commentId);
  if (comment === null || comment.status !== "shown") return { kind: "notFound" };
  if (comment.author_key === profile.number_key) return { kind: "own" };
  const byNumber = await checkLimits(bindings, [
    ["comment.reports", { kind: "numberSlot", numberKey: profile.number_key, ownerSlot: profile.owner_slot }],
  ]);
  if (byNumber) return { kind: "limit", refusal: byNumber };
  const reporterKey =
    principal.kind === "device"
      ? `address:${await hmacKey(bindings.settings.keyHmacSecret, "address", address)}`
      : `number:${profile.number_key}`;
  const counted = await reportComment(bindings.db, commentId, reporterKey, new Date(bindings.clock.now()));
  return { kind: "ok", counted };
}

// The comments of the card a report shows on, for the desk; null when the card has none.
export async function commentsFor(bindings: ServiceBindings, ticketNumber: string): Promise<DeskComments | null> {
  const card = (await shownCards(bindings)).find((one) => one.tickets.includes(ticketNumber));
  if (card === undefined) return null;
  const found = await deskComments(bindings.db, card.cardId);
  if (found.length === 0) return null;
  return {
    items: found.map((one) => ({
      id: one.id,
      text: one.text,
      status: one.status as DeskComments["items"][number]["status"],
      reports: one.reports,
      at: at(Date.parse(one.createdAt), "WIB"),
      authorHidden: one.authorHidden,
      figures: one.figures.map((figure) => ({
        id: figure.id,
        figure: figure.figure as CommentFigure,
        value: figure.value,
        quote: figure.quote,
        status: figure.status as DeskComments["items"][number]["figures"][number]["status"],
      })),
      decisions: one.decisions.map((decision) => ({
        action: decision.action as DeskComments["items"][number]["decisions"][number]["action"],
        fieldId: decision.fieldId,
        reason: decision.reason,
        by: decision.staffLabel,
        at: at(Date.parse(decision.at), "WIB"),
      })),
    })),
  };
}

const tidyReason = (typed: string | undefined) => {
  const reason = (typed ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  return reason === "" ? null : reason;
};

// A comment hidden from the card or shown again, by staff of the report's region (D139).
export function moderateComment(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
  commentId: string,
  decided: { readonly shown: boolean; readonly reason?: string },
): Promise<DeskChange> {
  return changeTicket(bindings, staff, "moderateComments", ticketNumber, async (found, now) => {
    const card = (await shownCards(bindings)).find((one) => one.tickets.includes(ticketNumber));
    const comment = await commentById(bindings.db, commentId);
    if (card === undefined || comment === null || comment.card_id !== card.cardId) return { kind: "notFound" };
    const done = await setCommentShown(bindings.db, staff, commentId, decided.shown, tidyReason(decided.reason), now);
    return done ? null : { kind: "changed", status: found.status };
  });
}

// Which of the report's figures a proposed one goes into: houses need their damage named.
const FIELD_OF: Readonly<Record<Exclude<CommentFigure, "houses">, string>> = {
  dead: "dead",
  missing: "missing",
  injured: "injured",
  displaced: "displacedPeople",
  flooded: "housesFlooded",
};
const HOUSE_LEVELS = ["housesHeavy", "housesModerate", "housesLight"];

const fieldError = (rule: string): DeskChange => ({
  kind: "invalid",
  error: { fieldId: "field", rule, params: {} },
});

// A proposed figure taken into the report whose values the card shows, as a new version told in its
// history, or turned down (D139). Staff may decide only for a card shown from their own region.
export function decideFigure(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
  figureId: number,
  decided: { readonly accept: boolean; readonly field?: string; readonly reason?: string },
): Promise<DeskChange> {
  return changeTicket(bindings, staff, "moderateComments", ticketNumber, async (found, now) => {
    const card = (await shownCards(bindings)).find((one) => one.tickets.includes(ticketNumber));
    const figure = await figureById(bindings.db, figureId);
    if (card === undefined || figure === null || figure.card_id !== card.cardId) return { kind: "notFound" };
    // A figure decided already is refused by the write itself, as is one decided meanwhile.
    const reason = tidyReason(decided.reason);
    if (!decided.accept) {
      const done = await rejectFigure(bindings.db, staff, { id: figure.id, commentId: figure.comment_id }, reason, now);
      return done ? null : { kind: "changed", status: found.status };
    }
    const target = await deskReport(bindings.db, staff.scope, card.ticketNumber);
    if (target === null) return { kind: "notAllowed" };
    if (ENDED.includes(target.status)) return { kind: "transitionRefused" };
    const fieldId =
      figure.figure === "houses"
        ? HOUSE_LEVELS.find((level) => level === decided.field)
        : FIELD_OF[figure.figure as Exclude<CommentFigure, "houses">];
    if (fieldId === undefined) return fieldError("comments.housesLevel");
    const states = target.states as FieldStates;
    const field = revisableOf(states).find((one) => one.fieldId === fieldId);
    if (field === undefined) return fieldError("comments.fieldNotUsed");
    const change = { fieldId: field.fieldId, from: field.count, to: figure.value } satisfies Change;
    const note = `Kabar warga diterima ${staff.label}: "${figure.quote}"`.slice(0, 300);
    const done = await acceptFigure(
      bindings.db,
      staff,
      {
        figureId: figure.id,
        commentId: figure.comment_id,
        reportId: target.reportId,
        ticketNumber: card.ticketNumber,
        status: target.status,
        revision: target.revision,
        change,
        quote: note,
        next: field.count === figure.value ? null : revised(states, [change], note),
        reason,
      },
      now,
    );
    return done ? null : { kind: "changed", status: found.status };
  });
}
