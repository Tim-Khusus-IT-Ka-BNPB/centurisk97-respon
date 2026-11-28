import { type DraftRecord, endDraft, isLive, loadDraft, openDraftOf, storedReply } from "../adapters/postgres/drafts";
import { createFollowUp, followUpState, sendFollowUpDraft, sentBody } from "../adapters/postgres/followUp";
import { draftPhotos } from "../adapters/postgres/photos";
import { profileBySlot } from "../adapters/postgres/reporters";
import { chosenHazardType, completePercent } from "../domain/fields/applicable";
import { type FollowUpRefusal, followUpPhotos, followUpRefusal, newsOf, withNews } from "../domain/followUp";
import { type DraftContent, type FollowUpOf, followUpContent } from "../domain/turn/content";
import { versionChanges } from "../domain/versions";
import { atomically, decide, sql } from "../platform/database";
import type { Principal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { LIFE_LINE } from "./draftView";
import { checkLimits, type LimitRefusal } from "./limits";
import { ownedReport } from "./tracking";
import { type Answer, viewOf } from "./turn";

export type FollowUpStart =
  | { readonly kind: "draft"; readonly draftId: string }
  | { readonly kind: "notFound" }
  | { readonly kind: "closed"; readonly reason: FollowUpRefusal | "noProfile" }
  // A report being written on this phone must be finished first.
  | { readonly kind: "openExists"; readonly draftId: string }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// "Tambah kabar": a draft of news for a sent report, or the one already open for it.
export async function startFollowUp(
  bindings: ServiceBindings,
  principal: Principal,
  ticketNumber: string,
): Promise<FollowUpStart> {
  const owned = await ownedReport(bindings, principal, ticketNumber);
  if (owned === null) return { kind: "notFound" };
  const { numberKey, ownerSlot } = owned;
  const reporterId = owned.reporterId as string;
  // A message of the chat was counted at its door.
  const refusal =
    principal.kind === "chat"
      ? null
      : await checkLimits(bindings, [["message.minute", { kind: "numberSlot", numberKey, ownerSlot }]]);
  if (refusal) return { kind: "limit", refusal };
  const { db } = bindings;
  return decide(async (): Promise<FollowUpStart | null> => {
    const at = new Date(bindings.clock.now());
    const report = await followUpState(db, ticketNumber);
    const reason = followUpRefusal({ ...report, sentAtMs: report.sentAt.getTime() }, at.getTime());
    if (reason !== null) return { kind: "closed", reason };
    const profile = await profileBySlot(db, reporterId, ownerSlot);
    if (profile === null) return { kind: "closed", reason: "noProfile" };
    const open = await openDraftOf(db, reporterId, ownerSlot);
    if (open !== null && isLive(open, at)) {
      const draft = await loadDraft(db, open.id);
      return draft?.followUpOf === ticketNumber
        ? { kind: "draft", draftId: open.id }
        : { kind: "openExists", draftId: open.id };
    }
    const followUp: FollowUpOf = {
      ticketNumber,
      base: report.states,
      photosLeft: followUpPhotos(report.photos),
    };
    const id = crypto.randomUUID();
    const done = await atomically(db, [
      ...(open === null ? [] : endDraft(open.id, "expired", at, sql`last_acted_at = ${open.lastActedAt}`)),
      ...createFollowUp(
        {
          id,
          reportId: report.reportId,
          reporterId,
          profileId: profile.id,
          ownerSlot,
          villageCode: report.villageCode,
          hazardType: report.hazardType,
          content: followUpContent(followUp),
          notices: [LIFE_LINE],
          opening: {
            speaker: "assistant",
            copyKey: "card.followUp.title",
            promptKey: null,
            params: { ticketNumber },
            cardKind: "summary",
          },
        },
        at,
      ),
    ]);
    return done === null ? null : { kind: "draft", draftId: id };
  });
}

export type FollowUpSent =
  | Answer
  | {
      readonly kind: "followUpClosed";
      readonly reason: FollowUpRefusal;
      readonly draft: Awaited<ReturnType<typeof viewOf>>;
    };

// "Kirim kabar": the next version of the report, from what the reporter told on top of the newest
// one. However often it is tapped, one draft makes one version.
export async function sendFollowUp(
  bindings: ServiceBindings,
  draft: DraftRecord,
  revision: number,
  turnKey: string,
  requestHash: string,
): Promise<FollowUpSent> {
  const { db } = bindings;
  return decide(async (): Promise<FollowUpSent | null> => {
    const stored = await storedReply(db, draft.id, turnKey);
    if (stored)
      return stored.requestHash === requestHash
        ? { kind: "ok", status: 200, body: stored.body }
        : { kind: "keyReused" };
    // The report before the draft: a send landing between the two reads then shows as sent, never
    // as a draft with nothing new on a report that already holds it.
    const ticketNumber = draft.followUpOf as string;
    const report = await followUpState(db, ticketNumber);
    const now = await loadDraft(db, draft.id);
    // Removed with its number while this send was decided.
    if (now === null) return { kind: "notFound" };
    if (now.state === "sent") return { kind: "ok", status: 200, body: sentBody(ticketNumber, report.sentAt) };
    const view = () => viewOf(bindings, now, [], turnKey);
    if (now.state !== "summary" || now.revision !== revision) return { kind: "changed", draft: await view() };
    const at = new Date(bindings.clock.now());
    const reason = followUpRefusal({ ...report, sentAtMs: report.sentAt.getTime() }, at.getTime());
    if (reason !== null) return { kind: "followUpClosed", reason, draft: await view() };
    const content = now.content as DraftContent;
    const states = withNews(report.states, newsOf((content.followUp as FollowUpOf).base, content.states));
    const photos = await draftPhotos(db, now.id);
    if (versionChanges(report.states, states).length === 0 && photos.length === 0)
      return { kind: "invalid", code: "followUp.nothingNew", errors: [], draft: await view() };
    const done = await sendFollowUpDraft(
      db,
      {
        draftId: now.id,
        revision,
        ticketNumber,
        report,
        states,
        completePercent: completePercent(states),
        hazardType: chosenHazardType(states) ?? report.hazardType,
        turnKey,
        requestHash,
      },
      at,
    );
    return done ? { kind: "ok", status: 201, body: sentBody(ticketNumber, report.sentAt) } : null;
  });
}
