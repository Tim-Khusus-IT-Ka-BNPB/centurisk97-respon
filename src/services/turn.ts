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
} from "../adapters/postgres/drafts";
import { draftPhotos, type PhotoRecord } from "../adapters/postgres/photos";
import { activeVillage, villageCentre } from "../adapters/postgres/places";
import { type ReportRecord, referenceFile, reportByDraft } from "../adapters/postgres/reports";
import type { DraftBody } from "../contract/draft";
import type { LanguageId } from "../copy/languages";
import { isFinal } from "../domain/draftStates";
import { checkFacilityFile } from "../domain/facilities";
import type { PlaceValue } from "../domain/fieldState";
import { chosenHazardType } from "../domain/fields/applicable";
import type { FieldId, GroupId } from "../domain/fields/catalogue";
import type { FieldError, ReporterRole } from "../domain/identityForm";
import { maskText } from "../domain/masking";
import { nearestFacilities } from "../domain/nearFacilities";
import { ownsDraft } from "../domain/ownership";
import { placeTries } from "../domain/placeText";
import { newlyChosenHazard, notedFacts, typedWords, withTranslation } from "../domain/turn/acknowledge";
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
import { draftView, draftZone, LIFE_LINE, type Notice, noticesOnRead, type SentTicket } from "./draftView";
import { answerLine, extractFrom } from "./extract";
import { checkLimits, type LimitRefusal } from "./limits";
import { locatePlace, searchPlaces } from "./places";
import { withSameEvent } from "./sameEvent";
import { phraseOf } from "./summary";
import { myReports, trackingOf, trackingToken } from "./tracking";

export type TurnRequest = {
  readonly revision: number;
  readonly turnKey: string;
  readonly kind: "answer" | "freeText" | "locate" | "back" | "editGroup" | "cancel" | "confirm" | "dismiss";
  readonly cardId: string | null;
  readonly optionIds: readonly string[];
  readonly values: Readonly<Record<string, string>>;
  readonly text: string;
  readonly groupId: GroupId | "photos" | null;
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
  // News that expired leaves its report as it was, so its owner is led back there, not told it is gone.
  if (draft.state === "expired") return draft.followUpOf === null ? { kind: "expired" } : { kind: "owned", draft };
  if (!isFinal(draft.state) && nowMs > draft.lastActedAt.getTime() + DRAFT_LIFE_MS) {
    await expireDraft(bindings.db, draft, new Date(nowMs));
    // Read again: it is expired now, unless a tap landed first and keeps it.
    return ownedDraft(bindings, principal, draftId);
  }
  return { kind: "owned", draft };
}

// The numbers near a sent report's point, or its village's centre; none when the file is not read.
async function nearestOf(bindings: ServiceBindings, report: ReportRecord) {
  const place = (report.states.place as { readonly value: PlaceValue }).value;
  const point = place.point ?? (await villageCentre(bindings.db, place.snapshotId, place.villageCode));
  const file = checkFacilityFile(await referenceFile(bindings.db, "facilityNumbers"));
  return file === null || point === null ? [] : nearestFacilities(file, point);
}

// What the sent card shows: the ticket, the thank-you name, the rating, the tracking link and view,
// and the numbers to call near the report.
async function sentDetails(bindings: ServiceBindings, draftId: string): Promise<SentTicket> {
  const report = (await reportByDraft(bindings.db, draftId)) as ReportRecord;
  return {
    nearest: await nearestOf(bindings, report),
    ticketNumber: report.ticketNumber,
    sentAt: report.sentAt,
    firstName: report.reporterName.split(" ")[0] as string,
    rating: report.rating,
    trackingToken: await trackingToken(bindings.settings.keyHmacSecret, report.id),
    tracking: await trackingOf(bindings, report),
  };
}

export async function viewOf(
  bindings: ServiceBindings,
  draft: DraftRecord,
  notices: readonly Notice[],
  turnKey: string | null,
  photos?: readonly PhotoRecord[],
): Promise<DraftBody> {
  const ticket = draft.state === "sent" && draft.followUpOf === null ? await sentDetails(bindings, draft.id) : null;
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
    else
      notices.push({
        kind: notice.kind,
        copyKey: notice.copyKey,
        params: "params" in notice ? { ...notice.params } : {},
        retryAt: null,
      });
  }
  return life ? [LIFE_LINE, ...notices] : notices;
}

// A text typed on a card in another language, and how it reads in Indonesian.
type Typed = { readonly fieldId: FieldId | null; readonly indonesian: string };

type Prepared =
  | { readonly input: TurnInput; readonly messages: NewMessage[]; readonly typed?: Typed | null }
  | { readonly errors: FieldError[] };

// A reading the page took: coordinates and accuracy as numbers, accuracy never negative.
function readingOf(values: Readonly<Record<string, string>>) {
  // An empty box is no number, not 0.
  const [lat, lon, accuracyM] = ["lat", "lon", "accuracy"].map((name) => Number(values[name]?.trim() || Number.NaN));
  const point = { lat: lat as number, lon: lon as number };
  const valid = [lat, lon, accuracyM].every((value) => Number.isFinite(value)) && (accuracyM as number) >= 0;
  return valid ? { ...point, accuracyM: accuracyM as number } : null;
}

// The village picked from the nearby list, which carries the reading it came from.
function nearbyVillage(content: DraftContent, code: string | null) {
  const reading = content.placeReading as PlaceReading | null | undefined;
  return reading?.nearby.find((one) => one.village.villageCode === code)?.village ?? null;
}

// Words typed on a card while the page is in another language are read for their Indonesian only:
// the card's own answer decides the values.
async function typedTranslation(
  bindings: ServiceBindings,
  draft: DraftRecord,
  question: Question,
  values: Readonly<Record<string, string>>,
  language: LanguageId,
): Promise<{ readonly language: string; readonly indonesian: string } | null> {
  const typed = typedWords(question, values);
  if (typed === null || language === "id") return null;
  const reporter = { name: draft.name, number: draft.number };
  const message = maskText(typed, reporter);
  const read = await extractFrom(bindings, draft, draft.content as DraftContent, message, draft.templatesOnly);
  return read.indonesian === null ? null : { language: read.language as string, indonesian: read.indonesian };
}

async function prepare(
  bindings: ServiceBindings,
  principal: Principal,
  draft: DraftRecord,
  request: TurnRequest,
  question: Question,
  photos: readonly PhotoRecord[],
  language: LanguageId,
): Promise<Prepared> {
  const reporter = { name: draft.name, number: draft.number };
  const content = draft.content as DraftContent;
  if (request.kind === "freeText") {
    const kind = classifyFreeText(request.text);
    if (kind.kind === "back" || kind.kind === "cancel") return { input: { kind: kind.kind }, messages: [] };
    if (kind.kind === "tooLong")
      return { errors: [{ fieldId: "text", rule: "message.tooLong", params: { length: kind.length } }] };
    if (kind.kind === "refused") return { input: { kind: "refused", topic: kind.topic }, messages: [] };
    if (kind.kind === "status") {
      const reports = await myReports(bindings, principal);
      return {
        input: { kind: "status", tickets: reports.map((report) => report.ticketNumber) },
        messages: [{ speaker: "reporter", textMasked: maskText(request.text, reporter) }],
      };
    }
    const message = maskText(request.text, reporter);
    const extraction = await extractFrom(bindings, draft, content, message, draft.templatesOnly);
    const messages: NewMessage[] = [
      { speaker: "reporter", textMasked: message, language: extraction.language, indonesian: extraction.indonesian },
    ];
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
    const translated = await typedTranslation(bindings, draft, question, request.values, language);
    return {
      input: { kind: "answer", answer: { optionIds: request.optionIds, values: request.values }, village },
      messages: line === "" ? [] : [{ speaker: "reporter", textMasked: line, ...translated }],
      typed:
        translated === null
          ? null
          : { fieldId: question.kind === "textQuestion" ? question.fieldId : null, indonesian: translated.indonesian },
    };
  }
  if (request.kind === "editGroup")
    return { input: { kind: "editGroup", groupId: request.groupId as GroupId | "photos" }, messages: [] };
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
  // The language the page is in: words typed on a card in another one are read for their Indonesian.
  language: LanguageId = "id",
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
  const prepared = await prepare(bindings, principal, draft, request, question, photos, language);
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
  const offered =
    outcome.kind === "next"
      ? { ...outcome, draft: await withSameEvent(bindings, before, translatedDraft(outcome.draft, prepared.typed)) }
      : outcome;
  const lines =
    offered.kind === "next"
      ? [
          ...prepared.messages,
          ...acknowledgement(before, offered, prepared.input, await namedPlace(bindings, offered, prepared.input)),
        ]
      : prepared.messages;
  return commit(bindings, draft, request, requestHash, offered, lines, photos);
}

// A text answer typed on a card in another language keeps its Indonesian, for the desk.
function translatedDraft(next: TurnDraft, typed: Typed | null | undefined): TurnDraft {
  const fieldId = typed?.fieldId ?? null;
  if (fieldId === null) return next;
  const states = withTranslation(next.content.states, fieldId, (typed as Typed).indonesian);
  return { ...next, content: { ...next.content, states } };
}

// The place the reporter named, when the place is asked next and the place data knows it, so the
// page can search it for them; null otherwise.
async function namedPlace(
  bindings: ServiceBindings,
  { question }: { readonly question: Question },
  input: TurnInput,
): Promise<string | null> {
  const place = input.kind === "story" ? input.extraction.place : null;
  if (place === null || question.kind !== "place") return null;
  for (const tried of placeTries(place)) {
    const found = await searchPlaces(bindings, tried, async () => null);
    if (found.kind === "ok" && found.value.total > 0) return tried;
  }
  return null;
}

// What Sigap says back before the next question: what it read from the reporter's words, the place
// they named, and the safety line of a hazard type chosen this turn.
function acknowledgement(
  before: TurnDraft,
  { draft: after }: { readonly draft: TurnDraft },
  input: TurnInput,
  place: string | null,
): NewMessage[] {
  const lines: NewMessage[] = [];
  const facts = input.kind === "story" ? notedFacts(before.content.states, after.content.states) : [];
  if (facts.length > 0)
    lines.push({
      speaker: "assistant",
      copyKey: "reply.noted",
      params: { facts: JSON.stringify(facts) },
      cardKind: null,
    });
  if (place !== null)
    lines.push({ speaker: "assistant", copyKey: "reply.notedPlace", params: { place }, cardKind: null });
  const hazard = newlyChosenHazard(before.content.states, after.content.states);
  if (hazard !== null) lines.push({ speaker: "assistant", copyKey: `safety.${hazard}`, params: {}, cardKind: null });
  return lines;
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
        lines.push({ speaker: "assistant", copyKey: notice.copyKey, params: notice.params, cardKind: null });
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
