import { DRAFT_LIFE_MS, endDraft, loadDraft, storedReply } from "../adapters/postgres/drafts";
import { draftPhotos } from "../adapters/postgres/photos";
import { latestConsent, profileById } from "../adapters/postgres/reporters";
import {
  insertReport,
  linkReport,
  nextSequence,
  recentSends,
  sendsBelow,
  sentTicket,
  storeTicketReply,
  ticketNumberOf,
} from "../adapters/postgres/send";
import { emergencyStates, type VictimAnswer } from "../domain/emergency";
import { applicableFields, completePercent } from "../domain/fields/applicable";
import type { FieldId } from "../domain/fields/catalogue";
import { LIMITS, rollingRetryAt } from "../domain/limits";
import { formatTicketNumber, ticketDay } from "../domain/ticketNumber";
import type { Triage } from "../domain/triage";
import type { DraftContent } from "../domain/turn/content";
import { atomically, changedOne, decide, holds, row, sql } from "../platform/database";
import { sha256Hex } from "../platform/keys";
import type { Principal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { draftZone, LIFE_LINE } from "./draftView";
import { type FollowUpSent, sendFollowUp } from "./followUp";
import { trackingToken } from "./tracking";
import { triageOnSend } from "./triage";
import { ownedDraft, viewOf } from "./turn";

// The fault switch of local and test: the send fails after its inserts, before commit.
class SendFault extends Error {}

// A condition that never holds, last in the batch: everything before it is rolled back.
const ROLL_BACK = holds(sql`1 = 0`);

const ticketBody = (ticket: { ticketNumber: string; sentAt: Date }) => ({
  ticketNumber: ticket.ticketNumber,
  sentAt: { utc: ticket.sentAt.toISOString(), zone: "WIB" as const },
});

type Sent =
  | { readonly kind: "sent"; readonly body: ReturnType<typeof ticketBody> }
  | { readonly kind: "already"; readonly body: ReturnType<typeof ticketBody> }
  | { readonly kind: "replay"; readonly status: number; readonly body: unknown; readonly hash: string }
  | { readonly kind: "changed" }
  // Removed with its number ("Hapus dari perangkat ini") before this send was written.
  | { readonly kind: "gone" }
  | { readonly kind: "limit"; readonly retryAtMs: number };

async function sendOnce(
  bindings: ServiceBindings,
  principal: Principal,
  draftId: string,
  revision: number,
  turnKey: string,
  requestHash: string,
  // Decided once per send, however often the write is tried again.
  triaged: (sending: Parameters<typeof triageOnSend>[1]) => Promise<Triage>,
): Promise<Sent | null> {
  const db = bindings.db;
  const nowMs = bindings.clock.now();
  const at = new Date(nowMs);
  const draft = await loadDraft(db, draftId);
  if (draft === null) return { kind: "gone" };
  const stored = await storedReply(db, draftId, turnKey);
  if (stored) return { kind: "replay", status: stored.status, body: stored.body, hash: stored.requestHash };
  const ticket = await sentTicket(db, draftId);
  if (ticket) return { kind: "already", body: ticketBody(ticket) };
  const profile = draft.profileId === null ? null : await profileById(db, draft.profileId);
  if (draft.state !== "summary" || draft.revision !== revision || profile === null) return { kind: "changed" };
  const since = new Date(nowMs - DRAFT_LIFE_MS);
  const max = LIMITS["send.rolling"].max;
  const sends = await recentSends(db, draft.numberKey, draft.ownerSlot, since);
  if (sends.count >= max) return { kind: "limit", retryAtMs: rollingRetryAt((sends.oldest as Date).getTime()) };
  const day = ticketDay(nowMs);
  const ticketNumber = ticketNumberOf(formatTicketNumber(day, 1).slice(0, -3), day);
  const content = draft.content as DraftContent;
  const emergency = content.emergency ?? null;
  const states =
    emergency === null ? content.states : emergencyStates(content.states, nowMs, draftZone(draft.villageCode));
  const reportId = crypto.randomUUID();
  const trackingHash = await sha256Hex(await trackingToken(bindings.settings.keyHmacSecret, reportId));
  const consent = await latestConsent(db, profile.id);
  // Removed with its number between the reads: decide again on what is there now.
  if (consent === null) return null;
  const triage = await triaged({
    draftId: draft.id,
    numberKey: draft.numberKey,
    villageCode: draft.villageCode as string,
    states,
    emergency: emergency !== null,
    photos: await draftPhotos(db, draft.id),
  });
  const joined = content.sameEvent?.joined ?? null;
  const joinedAt =
    joined === null
      ? null
      : await row<{ sent_at: string }>(db, sql`select sent_at from report where ticket_number = ${joined}`);
  const done = await atomically(db, [
    // The draft is still the summary that was read, its binding is still there, and the limit still holds.
    sql`update report_draft set revision = revision where id = ${draft.id} and revision = ${revision}
      and state = 'summary' and profile_id = ${profile.id}`,
    changedOne,
    holds(sendsBelow(draft.numberKey, draft.ownerSlot, since, max)),
    nextSequence(day),
    ...insertReport({
      reportId,
      trackingHash,
      ticketNumber,
      draftId: draft.id,
      reporterId: draft.reporterId,
      numberKey: draft.numberKey,
      ownerSlot: draft.ownerSlot,
      numberUnverified: principal.kind === "device",
      hazardType: draft.hazardType as string,
      villageCode: draft.villageCode as string,
      sentAt: at,
      // The version holds what the summary showed: fields hidden by type or by a parent of 0 are left out.
      content: {
        ...content,
        states: Object.fromEntries(applicableFields(states).map((field) => [field.id, states[field.id as FieldId]])),
      },
      emergency: emergency && { kind: "chat", victims: emergency.victims as VictimAnswer },
      reporter: {
        name: profile.name,
        number: profile.number,
        role: profile.role,
        officerRegency: profile.officer_regency,
        officerPosition: profile.officer_position,
      },
      consent,
      completePercent: completePercent(states),
      triage,
    }),
    ...endDraft(draft.id, "sent", at),
    ...(joined !== null && joinedAt !== null
      ? linkReport(reportId, joined, ticketDay(Date.parse(joinedAt.sent_at)), at)
      : []),
    storeTicketReply(draft.id, turnKey, requestHash, ticketNumber, at),
    ...(bindings.settings.faultSend ? [ROLL_BACK] : []),
  ]);
  if (done === null) {
    if (bindings.settings.faultSend) throw new SendFault();
    return null;
  }
  const [sentNumber] = done[4] as { ticket_number: string }[];
  return {
    kind: "sent",
    body: ticketBody({ ticketNumber: (sentNumber as { ticket_number: string }).ticket_number, sentAt: at }),
  };
}

// "Kirim": one ticket per draft however often it is tapped. A retry with the same turn key, or a
// send on a draft already sent, answers with the same ticket.
export async function sendDraft(
  bindings: ServiceBindings,
  principal: Principal,
  draftId: string,
  revision: number,
  turnKey: string,
  requestHash: string,
): Promise<FollowUpSent | { kind: "failed"; draft: Awaited<ReturnType<typeof viewOf>> }> {
  const owned = await ownedDraft(bindings, principal, draftId);
  if (owned.kind !== "owned") return owned;
  if (owned.draft.followUpOf !== null) return sendFollowUp(bindings, owned.draft, revision, turnKey, requestHash);
  let sent: Sent;
  let triaged: Promise<Triage> | null = null;
  const triageOnce = (sending: Parameters<typeof triageOnSend>[1]) => {
    triaged ??= triageOnSend(bindings, sending);
    return triaged;
  };
  try {
    sent = await decide(() => sendOnce(bindings, principal, draftId, revision, turnKey, requestHash, triageOnce));
  } catch (error) {
    if (!(error instanceof SendFault)) throw error;
    return { kind: "failed", draft: await viewOf(bindings, owned.draft, [], turnKey) };
  }
  if (sent.kind === "sent") return { kind: "ok", status: 201, body: sent.body };
  if (sent.kind === "already") return { kind: "ok", status: 200, body: sent.body };
  if (sent.kind === "replay")
    return sent.hash === requestHash ? { kind: "ok", status: 200, body: sent.body } : { kind: "keyReused" };
  const fresh = sent.kind === "gone" ? null : await loadDraft(bindings.db, draftId);
  // Removed with its number while this send was decided: the draft is no longer there.
  if (fresh === null) return { kind: "notFound" };
  if (sent.kind === "limit")
    return {
      kind: "limit",
      refusal: { limitId: "send.rolling", retryAtMs: sent.retryAtMs },
      draft: await viewOf(bindings, fresh, [LIFE_LINE], turnKey),
    };
  return { kind: "changed", draft: await viewOf(bindings, fresh, [], turnKey) };
}
