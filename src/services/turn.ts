import {
  addMessages,
  DRAFT_LIFE_MS,
  type DraftRecord,
  endDraft,
  expireDraft,
  loadDraft,
  type NewMessage,
  type StoredReply,
  storedReply,
  storeReply,
  touchDraft,
  transcript,
  transcriptRows,
  truncateTranscript,
  updateDraft,
} from "../adapters/d1/drafts";
import { draftPhotos, type PhotoRecord } from "../adapters/d1/photos";
import { activeVillage } from "../adapters/d1/places";
import { sentTicket } from "../adapters/d1/send";
import type { DraftBody } from "../contract/draft";
import { isFinal } from "../domain/draftStates";
import { chosenHazardType } from "../domain/fields/applicable";
import type { GroupId } from "../domain/fields/catalogue";
import type { FieldError, ReporterRole } from "../domain/identityForm";
import { maskText } from "../domain/masking";
import { ownsDraft } from "../domain/ownership";
import type { DraftContent, PlaceReading, Question } from "../domain/turn/content";
import {
  currentQuestion,
  type DraftSnapshot,
  runTurn,
  type TurnDraft,
  type TurnInput,
  type TurnOutcome,
} from "../domain/turn/engine";
import { classifyFreeText } from "../domain/turn/freeText";
import { atomically, changedOne, sql } from "../platform/database";
import type { Principal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { cardFor } from "./cards";
import { draftView, draftZone, LIFE_LINE, type Notice, noticesOnRead } from "./draftView";
import { answerLine, extractFrom } from "./extract";
import { checkLimits, type LimitRefusal } from "./limits";
import { locatePlace } from "./places";
import { phraseOf } from "./summary";

export type TurnRequest = {
  readonly revision: number;
  readonly turnKey: string;
  readonly kind: "answer" | "freeText" | "locate" | "back" | "editGroup" | "cancel" | "confirm" | "dismiss";
  readonly cardId: string | null;
  readonly optionIds: readonly string[];
  readonly values: Readonly<Record<string, string>>;
  readonly text: string;
  readonly groupId: GroupId | null;
  readonly villageCode: string | null;
};

export type Answer =
  | { readonly kind: "ok"; readonly status: number; readonly body: unknown }
  | { readonly kind: "notFound" }
  | { readonly kind: "expired" }
  | { readonly kind: "keyReused" }
  | { readonly kind: "changed"; readonly draft: DraftBody }
  | {
      readonly kind: "invalid";
      readonly code: string;
      readonly errors: readonly FieldError[];
      readonly draft: DraftBody;
    }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal; readonly draft: DraftBody };

export type Owned =
  | { readonly kind: "owned"; readonly draft: DraftRecord }
  | { readonly kind: "notFound" }
  | { readonly kind: "expired" };

// Loads a draft for its owner. A draft past 24 hours since the reporter last acted is emptied
// here, in this request, and its owner is told it expired; anyone else is told it does not exist.
export async function ownedDraft(bindings: ServiceBindings, principal: Principal, draftId: string): Promise<Owned> {
  const draft = await loadDraft(bindings.db, draftId);
  if (!draft || !ownsDraft(principal, draft)) return { kind: "notFound" };
  const nowMs = bindings.clock.now();
  if (draft.state === "expired") return { kind: "expired" };
  if (!isFinal(draft.state) && nowMs > draft.lastActedAt.getTime() + DRAFT_LIFE_MS) {
    await expireDraft(bindings.db, draft, new Date(nowMs));
    // Read again: it is expired now, unless a tap landed first and keeps it.
    return ownedDraft(bindings, principal, draftId);
  }
  return { kind: "owned", draft };
}

export async function viewOf(
  bindings: ServiceBindings,
  draft: DraftRecord,
  notices: readonly Notice[],
  turnKey: string | null,
  photos?: readonly PhotoRecord[],
): Promise<DraftBody> {
  const ticket = draft.state === "sent" ? await sentTicket(bindings.db, draft.id) : null;
  return draftView({
    draft,
    transcript: await transcript(bindings.db, draft.id),
    notices,
    turnKey,
    nowMs: bindings.clock.now(),
    ticket,
    photos: photos ?? (await draftPhotos(bindings.db, draft.id)),
  });
}

// Opening a draft counts as acting on it, so its 24 hours start again. Every turn ends in a
// redirect, so the notices the turn raised are shown by this read, once.
export async function readDraft(bindings: ServiceBindings, principal: Principal, draftId: string): Promise<Answer> {
  const owned = await ownedDraft(bindings, principal, draftId);
  if (owned.kind !== "owned") return owned;
  if (isFinal(owned.draft.state))
    return { kind: "ok", status: 200, body: await viewOf(bindings, owned.draft, [], null) };
  const notices = noticesOnRead(owned.draft.pendingNotices);
  await touchDraft(bindings.db, draftId, new Date(bindings.clock.now()));
  const draft = (await loadDraft(bindings.db, draftId)) as DraftRecord;
  return { kind: "ok", status: 200, body: await viewOf(bindings, draft, notices, null) };
}

// Every message counts against the number, the device and the address; a photo is a message.
export function checkMessageLimits(
  bindings: ServiceBindings,
  principal: Principal,
  address: string,
  draft: DraftRecord,
): Promise<LimitRefusal | null> {
  const numberSlot = { kind: "numberSlot", numberKey: draft.numberKey, ownerSlot: draft.ownerSlot } as const;
  return checkLimits(bindings, [
    ["message.minute", numberSlot],
    ["message.hour", numberSlot],
    ["message.day", numberSlot],
    ...(principal.kind === "device"
      ? ([["device.messageHour", { kind: "device", deviceId: principal.deviceId }]] as const)
      : []),
    ["address.messages", { kind: "address", bucket: address }],
  ]);
}

// A turn key seen before: the stored reply for the same request, a refusal for another.
export function replayOf(stored: StoredReply, requestHash: string): Answer {
  return stored.requestHash === requestHash
    ? { kind: "ok", status: stored.status, body: stored.body }
    : { kind: "keyReused" };
}

function turnDraft(draft: DraftRecord): TurnDraft {
  return {
    state: draft.state,
    content: draft.content as DraftContent,
    asked: draft.asked,
    backStack: draft.backStack,
    offTopicCount: draft.offTopicCount,
    templatesOnly: draft.templatesOnly,
  };
}

function noticesOf(outcome: Extract<TurnOutcome, { kind: "next" }>, extraLife: boolean): Notice[] {
  const notices: Notice[] = [];
  let life = extraLife;
  for (const notice of outcome.notices) {
    if (notice.kind === "lifeLine") life = true;
    else notices.push({ kind: notice.kind, copyKey: notice.copyKey, params: {}, retryAt: null });
  }
  return life ? [LIFE_LINE, ...notices] : notices;
}

type Prepared = { readonly input: TurnInput; readonly messages: NewMessage[] } | { readonly errors: FieldError[] };

// A reading the page took: coordinates and accuracy as numbers, accuracy never negative.
function readingOf(values: Readonly<Record<string, string>>) {
  // An empty box is no number, not 0.
  const [lat, lon, accuracyM] = ["lat", "lon", "accuracy"].map((name) => Number(values[name]?.trim() || Number.NaN));
  const valid = [lat, lon, accuracyM].every((value) => Number.isFinite(value)) && (accuracyM as number) >= 0;
  return valid ? { lat: lat as number, lon: lon as number, accuracyM: accuracyM as number } : null;
}

// The village picked from the nearby list, which carries the reading it came from.
function nearbyVillage(content: DraftContent, code: string | null) {
  const reading = content.placeReading as PlaceReading | null | undefined;
  return reading?.nearby.find((one) => one.village.villageCode === code)?.village ?? null;
}

async function prepare(
  bindings: ServiceBindings,
  draft: DraftRecord,
  request: TurnRequest,
  question: Question,
  photos: readonly PhotoRecord[],
): Promise<Prepared> {
  const reporter = { name: draft.name, number: draft.number };
  const content = draft.content as DraftContent;
  if (request.kind === "freeText") {
    const kind = classifyFreeText(request.text);
    if (kind.kind === "back" || kind.kind === "cancel") return { input: { kind: kind.kind }, messages: [] };
    if (kind.kind === "tooLong")
      return { errors: [{ fieldId: "text", rule: "message.tooLong", params: { length: kind.length } }] };
    if (kind.kind === "refused") return { input: { kind: "refused", topic: kind.topic }, messages: [] };
    const message = maskText(request.text, reporter);
    const extraction = await extractFrom(bindings, draft, content, message, draft.templatesOnly);
    const messages: NewMessage[] = [{ speaker: "reporter", textMasked: message }];
    if (extraction.reply && extraction.reply !== "none" && extraction.topic === "disaster")
      messages.push({ speaker: "assistant", copyKey: `reply.${extraction.reply}`, params: {}, cardKind: null });
    return { input: { kind: "story", message, extraction }, messages };
  }
  if (request.kind === "locate") {
    const reading = readingOf(request.values);
    if (reading === null) return { errors: [{ fieldId: "location", rule: "location.invalid", params: {} }] };
    return { input: { kind: "located", result: await locatePlace(bindings, reading) }, messages: [] };
  }
  if (request.kind === "answer") {
    let village = null;
    if (question.kind === "place" && request.villageCode)
      village = await activeVillage(bindings.db, request.villageCode);
    if (question.kind === "placeConfirm") village = nearbyVillage(content, request.villageCode);
    const card = cardFor(question, content, {
      cardId: "",
      nowMs: bindings.clock.now(),
      zone: draftZone(draft.villageCode),
      reporter: { name: "", role: "citizen" },
      completePercent: 0,
      asked: draft.asked,
      photos,
    });
    // A place taken shows as the village's name, whether picked, read from GPS or confirmed.
    const confirmed =
      question.kind === "placeConfirm" && request.optionIds[0] === "confirm"
        ? (content.placeReading as PlaceReading).village
        : null;
    const named = village ?? confirmed;
    const line = named ? named.villageName : answerLine(card, request.optionIds, request.values, reporter);
    return {
      input: { kind: "answer", answer: { optionIds: request.optionIds, values: request.values }, village },
      messages: line === "" ? [] : [{ speaker: "reporter", textMasked: line }],
    };
  }
  if (request.kind === "editGroup")
    return { input: { kind: "editGroup", groupId: request.groupId as GroupId }, messages: [] };
  return { input: { kind: request.kind }, messages: [] };
}

// One turn: replay by turn key, the message limits, the stale check, then code decides the next
// card. The model runs before anything is written; the write holds only at the revision it was decided on.
export async function takeTurn(
  bindings: ServiceBindings,
  principal: Principal,
  address: string,
  draftId: string,
  request: TurnRequest,
  requestHash: string,
): Promise<Answer> {
  const owned = await ownedDraft(bindings, principal, draftId);
  if (owned.kind !== "owned") return owned;
  const { draft } = owned;
  const stored = await storedReply(bindings.db, draft.id, request.turnKey);
  if (stored) return replayOf(stored, requestHash);
  if (isFinal(draft.state))
    return { kind: "ok", status: 200, body: await viewOf(bindings, draft, [], request.turnKey) };
  const refusal = await checkMessageLimits(bindings, principal, address, draft);
  if (refusal) return { kind: "limit", refusal, draft: await viewOf(bindings, draft, [LIFE_LINE], request.turnKey) };
  const changed = async () => ({ kind: "changed" as const, draft: await viewOf(bindings, draft, [], request.turnKey) });
  if (request.revision !== draft.revision) return changed();
  if (request.kind === "answer" && request.cardId !== `c-${draft.revision}`) return changed();
  const before = turnDraft(draft);
  const question = currentQuestion(before);
  const photos = await draftPhotos(bindings.db, draft.id);
  const prepared = await prepare(bindings, draft, request, question, photos);
  if ("errors" in prepared)
    return {
      kind: "invalid",
      code: "request.invalidFields",
      errors: prepared.errors,
      draft: await viewOf(bindings, draft, [], request.turnKey),
    };
  const nowMs = bindings.clock.now();
  const context = {
    nowMs,
    zone: draftZone(draft.villageCode),
    reporter: { name: draft.name, number: draft.number },
    phraseOf,
    photoCount: photos.length,
  };
  const outcome = runTurn(before, prepared.input, context);
  if (outcome.kind === "stale") return changed();
  if (outcome.kind === "invalid")
    return {
      kind: "invalid",
      code: "request.invalidFields",
      errors: outcome.errors,
      draft: await viewOf(bindings, draft, [], request.turnKey),
    };
  if (outcome.kind === "backRefused")
    return {
      kind: "invalid",
      code: outcome.code,
      errors: [],
      draft: await viewOf(bindings, draft, [], request.turnKey),
    };
  return commit(bindings, draft, request, requestHash, outcome, prepared.messages, photos);
}

async function commit(
  bindings: ServiceBindings,
  draft: DraftRecord,
  request: TurnRequest,
  requestHash: string,
  outcome: Exclude<TurnOutcome, { kind: "stale" | "invalid" | "backRefused" }>,
  messages: NewMessage[],
  photos: readonly PhotoRecord[],
): Promise<Answer> {
  const db = bindings.db;
  const at = new Date(bindings.clock.now());
  // A retry with the same key that landed while this one was decided loses the race below and replays.
  if (outcome.kind === "cancelled") {
    const ended = await atomically(db, endDraft(draft.id, "cancelled", at, sql`revision = ${draft.revision}`));
    if (ended === null) return lostRace(bindings, draft.id, request, requestHash);
    const fresh = (await loadDraft(db, draft.id)) as DraftRecord;
    return { kind: "ok", status: 200, body: await viewOf(bindings, fresh, [], request.turnKey) };
  }
  const history = await transcript(db, draft.id);
  const { draft: next, undoneAfter } = withHistoryMarks(history.length, draft, outcome.draft);
  const village = next.content.states.place;
  const villageCode = village?.state === "value" ? (village.value as { villageCode: string }).villageCode : null;
  const notices = noticesOf(outcome, false);
  const lines: NewMessage[] = [];
  if (undoneAfter === null) {
    lines.push(...messages);
    for (const notice of notices)
      if (notice.kind === "refusal")
        lines.push({ speaker: "assistant", copyKey: notice.copyKey, params: {}, cardKind: null });
    const card = cardFor(currentQuestion(next), next.content, {
      cardId: "",
      nowMs: at.getTime(),
      zone: draftZone(villageCode),
      reporter: { name: draft.name as string, role: draft.role as ReporterRole },
      completePercent: 0,
      asked: next.asked,
      photos,
    });
    lines.push({
      speaker: "assistant",
      copyKey: card.titleKey,
      promptKey: card.promptKey,
      params: card.params,
      cardKind: card.kind,
    });
  }
  const write = { ...next, villageCode, hazardType: chosenHazardType(next.content.states), pendingNotices: notices };
  // The reply is the draft as this write leaves it, so a retry with the same key answers the same.
  const body = draftView({
    draft: { ...draft, ...write, revision: draft.revision + 1, lastActedAt: at },
    transcript: undoneAfter === null ? [...history, ...transcriptRows(lines, at)] : history.slice(0, undoneAfter),
    notices,
    turnKey: request.turnKey,
    nowMs: bindings.clock.now(),
    ticket: null,
    photos,
  });
  const done = await atomically(db, [
    updateDraft(draft.id, draft.revision, write, at),
    changedOne,
    ...(undoneAfter === null ? addMessages(draft.id, lines, at) : [truncateTranscript(draft.id, undoneAfter)]),
    storeReply(draft.id, request.turnKey, { requestHash, status: 200, body }, at),
  ]);
  if (done === null) return lostRace(bindings, draft.id, request, requestHash);
  return { kind: "ok", status: 200, body };
}

// Another turn was written first: the same key replays its reply, any other turn is told the draft changed.
async function lostRace(
  bindings: ServiceBindings,
  draftId: string,
  request: TurnRequest,
  requestHash: string,
): Promise<Answer> {
  const again = await storedReply(bindings.db, draftId, request.turnKey);
  if (again) return replayOf(again, requestHash);
  const fresh = (await loadDraft(bindings.db, draftId)) as DraftRecord;
  return { kind: "changed", draft: await viewOf(bindings, fresh, [], request.turnKey) };
}

// A step that can be undone remembers where the history stood before it; undoing it ("kembali")
// takes back the lines it wrote, so the history never holds a question left without its answer.
// History lines are numbered 1 to n, so where it stands is its length.
function withHistoryMarks(
  historyLength: number,
  before: DraftRecord,
  next: TurnDraft,
): { readonly draft: TurnDraft; readonly undoneAfter: number | null } {
  const previous = before.backStack.at(-1);
  if (next.backStack.length < before.backStack.length)
    // A step stored before the history was marked keeps its lines.
    return { draft: next, undoneAfter: (previous as DraftSnapshot).transcriptSeq ?? null };
  const pushed = next.backStack.at(-1);
  if (pushed === undefined || pushed === previous) return { draft: next, undoneAfter: null };
  const marked = { ...pushed, transcriptSeq: historyLength };
  return { draft: { ...next, backStack: [...next.backStack.slice(0, -1), marked] }, undoneAfter: null };
}
