import { type ChatSession, chatSession, forgetChat, saveChatSession } from "../adapters/d1/chat";
import { addNewsChoice, newsChoice } from "../adapters/d1/chatNews";
import { DRAFT_LIFE_MS, type DraftRecord, loadDraft, openDraftOf, touchDraft } from "../adapters/d1/drafts";
import { followUpState } from "../adapters/d1/followUp";
import { isAllowed } from "../adapters/d1/pilot";
import { makeEmergency, type ProfileRow, profileBySlot, reporterIdOf, updateProfile } from "../adapters/d1/reporters";
import type { Card } from "../contract/card";
import type { DraftBody } from "../contract/draft";
import { hazardKey } from "../copy/hazardKey";
import { longDate, retryText } from "../copy/time";
import { type Command, newsWithTicket, readCommand, tellsOfEvent } from "../domain/chat/commands";
import {
  type Choice,
  readChoice,
  readDay,
  readHour,
  readNeighbourhood,
  readNumbers,
  saysSkip,
  saysUnknown,
} from "../domain/chat/reply";
import {
  type CardStep,
  type ChatStep,
  cardStepAt,
  type IdentityStep,
  identityMove,
  isIdentityStep,
  type TicketStep,
} from "../domain/chat/step";
import { type DraftState, isFinal } from "../domain/draftStates";
import type { GroupId } from "../domain/fields/catalogue";
import { followUpRefusal } from "../domain/followUp";
import type { Point } from "../domain/geo";
import { checkIdentity, type Identity } from "../domain/identityForm";
import { LENGTHS } from "../domain/limits";
import { maskText } from "../domain/masking";
import { SESSION_SLOT } from "../domain/ownership";
import type { SharedPoint } from "../domain/photoChecks";
import type { DraftContent } from "../domain/turn/content";
import { classifyFreeText } from "../domain/turn/freeText";
import { run } from "../platform/database";
import { hmacKey } from "../platform/keys";
import type { Principal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { latestNews, queueDocument } from "./chatNews";
import {
  askedAgain,
  cardChoices,
  cardText,
  groupChoices,
  hourText,
  message,
  noticesText,
  numbered,
  otherText,
  placesText,
  t,
} from "./chatWords";
import { startFollowUp } from "./followUp";
import { checkLimits } from "./limits";
import { addPhoto, placePhotos } from "./photos";
import { areaVillages, searchPlaces } from "./places";
import { giveConsent, startDraft } from "./reporters";
import { sendDraft } from "./send";
import { myReports, ownedReport } from "./tracking";
import { type Answer, ownedDraft, type TurnRequest, takeTurn, viewOf } from "./turn";

// A report in a WhatsApp chat: each message of a number is one turn of the same conversation the web
// page has, and the answer is the next question as text.

type ChatPrincipal = Extract<Principal, { kind: "chat" }>;

type Chat = {
  readonly bindings: ServiceBindings;
  readonly number: string;
  readonly numberKey: string;
  readonly principal: ChatPrincipal;
  // Who reports from this number, once they agreed.
  readonly profile: ProfileRow | null;
  readonly session: ChatSession;
  readonly nowMs: number;
};

// The answer, and where the chat stands after it; nothing is being asked beside the card when no step is named.
type Reply = { readonly text: string; readonly step?: ChatStep | null; readonly shared?: SharedPoint | null };

export type ChatAnswer =
  | { readonly kind: "reply"; readonly text: string }
  // Not a number of the pilot: nothing is read of it, kept or sent.
  | { readonly kind: "notAllowed" }
  // A photo that is not asked for now, with what is.
  | { readonly kind: "notNow"; readonly text: string }
  | { readonly kind: "limit"; readonly text: string; readonly retryAtMs: number };

const MESSAGE_LIMITS = ["message.minute", "message.hour", "message.day"] as const;

async function openChat(bindings: ServiceBindings, number: string): Promise<Chat | null> {
  const nowMs = bindings.clock.now();
  const numberKey = await hmacKey(bindings.settings.keyHmacSecret, "number", number);
  if (!(await isAllowed(bindings.db, numberKey))) return null;
  const reporterId = await reporterIdOf(bindings.db, numberKey);
  return {
    bindings,
    number,
    numberKey,
    principal: { kind: "chat", reporterId },
    profile: reporterId === null ? null : await profileBySlot(bindings.db, reporterId, SESSION_SLOT),
    session: await chatSession(bindings.db, numberKey, new Date(nowMs - DRAFT_LIFE_MS)),
    nowMs,
  };
}

const retryWords = (chat: Chat, retryAtMs: number) => {
  const { key, params } = retryText({ utc: new Date(retryAtMs).toISOString(), zone: "WIB" }, chat.nowMs);
  return t(key, params);
};

// Every message of a number counts, whatever it says.
async function overLimit(chat: Chat): Promise<ChatAnswer | null> {
  const subject = { kind: "numberSlot", numberKey: chat.numberKey, ownerSlot: SESSION_SLOT } as const;
  const refusal = await checkLimits(
    chat.bindings,
    MESSAGE_LIMITS.map((id) => [id, subject] as const),
  );
  if (refusal === null) return null;
  const retryAtMs = refusal.retryAtMs as number;
  return { kind: "limit", text: t("whatsapp.limit", { retryTime: retryWords(chat, retryAtMs) }), retryAtMs };
}

async function settled(chat: Chat, reply: Reply): Promise<string> {
  const { db } = chat.bindings;
  const next: ChatSession = { step: reply.step ?? null, shared: reply.shared ?? chat.session.shared };
  if (next.step === null && next.shared === null) await forgetChat(db, chat.numberKey);
  else await saveChatSession(db, chat.numberKey, next, new Date(chat.nowMs));
  return reply.text;
}

// The report being written in this chat, and whether one has just expired.
async function currentDraft(chat: Chat): Promise<{ draft: DraftRecord | null; expired: boolean }> {
  const { bindings, principal } = chat;
  if (principal.reporterId === null) return { draft: null, expired: false };
  const open = await openDraftOf(bindings.db, principal.reporterId, SESSION_SLOT);
  if (open === null) return { draft: null, expired: false };
  const owned = await ownedDraft(bindings, principal, open.id);
  const draft = owned.kind === "owned" && !isFinal(owned.draft.state) ? owned.draft : null;
  return { draft, expired: draft === null };
}

const viewed = (chat: Chat, draft: DraftRecord): Promise<DraftBody> => viewOf(chat.bindings, draft, [], null);

const cardOf = async (chat: Chat, draft: DraftRecord): Promise<string> => cardText((await viewed(chat, draft)).card);

const againOf = async (chat: Chat, draft: DraftRecord): Promise<string> => askedAgain((await viewed(chat, draft)).card);

const fresh = async (chat: Chat, draftId: string) => (await loadDraft(chat.bindings.db, draftId)) as DraftRecord;

const FIELD_ERROR: Readonly<Record<string, string>> = { "message.tooLong": "whatsapp.tooLong" };

// What a card asks, apart from which revision of the draft asks it.
const asked = ({ cardId: _id, ...card }: Card) => JSON.stringify(card);

const statesOf = (draft: DraftRecord) => JSON.stringify((draft.content as DraftContent).states);

// A sentence that moved nothing on: whether it was noted all the same.
async function unmoved(chat: Chat, before: DraftRecord, card: Card): Promise<string | null> {
  const was = (await viewed(chat, before)).card;
  if (asked(was) !== asked(card)) return null;
  const after = await fresh(chat, before.id);
  return t(statesOf(before) === statesOf(after) ? "whatsapp.wordsOnly" : "whatsapp.noted");
}

// What the assistant says to a story, before its next question.
const sympathy = (body: DraftBody): string[] => {
  const last = body.transcript.findLastIndex((line) => line.speaker === "reporter");
  return body.transcript
    .slice(last + 1)
    .flatMap((line) => (line.speaker === "assistant" && /^reply\.[a-z]+$/.test(line.copyKey) ? [t(line.copyKey)] : []));
};

async function worded(
  chat: Chat,
  draft: DraftRecord,
  answer: Answer,
  said: "words" | "answer",
  step: CardStep | null,
): Promise<Reply> {
  switch (answer.kind) {
    case "ok": {
      const body = answer.body as DraftBody;
      if (isFinal(body.state as DraftState)) return { text: cardText(body.card) };
      const refused = body.notices.some((notice) => notice.kind === "refusal");
      const still = said === "words" && !refused ? await unmoved(chat, draft, body.card) : null;
      const card = refused || still !== null ? askedAgain(body.card) : cardText(body.card);
      return { text: message(noticesText(body.notices), ...sympathy(body), still, card) };
    }
    case "invalid": {
      const errors = answer.errors.map((error) =>
        t(FIELD_ERROR[error.rule] ?? `fieldError.${error.rule}`, error.params),
      );
      const why = errors.length === 0 ? [t(`error.${answer.code}`)] : errors;
      // Half an answer stays asked for.
      if (step?.kind === "hour") return { text: message(...why, hourOf(answer.draft.card)), step };
      return { text: message(...why, cardText(answer.draft.card)) };
    }
    case "changed":
      return { text: message(t("whatsapp.busy"), cardText(answer.draft.card)) };
    default:
      return { text: message(t("whatsapp.expired"), menu()) };
  }
}

const hourOf = (card: Card) => hourText((card as Extract<Card, { kind: "timeCard" }>).zone);

type Act = Partial<TurnRequest> & Pick<TurnRequest, "kind">;

async function turn(chat: Chat, draft: DraftRecord, act: Act, step: CardStep | null = null): Promise<Reply> {
  const request: TurnRequest = {
    revision: draft.revision,
    turnKey: crypto.randomUUID(),
    cardId: `c-${draft.revision}`,
    optionIds: [],
    values: {},
    text: "",
    groupId: null,
    villageCode: null,
    ...act,
  };
  const answer = await takeTurn(chat.bindings, chat.principal, null, draft.id, request, request.turnKey);
  return worded(chat, draft, answer, act.kind === "freeText" ? "words" : "answer", step);
}

const words = (chat: Chat, draft: DraftRecord, text: string): Promise<Reply> =>
  turn(chat, draft, { kind: "freeText", text });

const unclear = (card: Card, why: string, step: ChatStep | null = null): Reply => ({
  text: message(why, askedAgain(card)),
  step,
});

const notChosen = (read: { kind: "outOfRange"; max: number } | { kind: "onlyOne" }): string =>
  read.kind === "outOfRange" ? t("whatsapp.unclear.range", { max: read.max }) : t("whatsapp.unclear.onlyOne");

// One or more of a card's numbered answers, or the reporter's own words.
function chosen(chat: Chat, draft: DraftRecord, card: Card, text: string, multiple: boolean): Promise<Reply> | Reply {
  const choices = cardChoices(card);
  const read = readChoice(text, choices, multiple);
  if (read.kind === "words") return words(chat, draft, text);
  if (read.kind !== "picked") return unclear(card, notChosen(read));
  const open = choices.find((choice) => choice.freeText && read.ids.includes(choice.id));
  if (open && read.words === "")
    return { text: otherText(open.label), step: { kind: "other", revision: draft.revision, picked: read.ids } };
  return turn(chat, draft, { kind: "answer", optionIds: read.ids, values: open ? { other: read.words } : {} });
}

// A place by name: a number of the list last shown, else a search, inside the area opened if one is.
async function placeByName(
  chat: Chat,
  draft: DraftRecord,
  card: Card,
  text: string,
  step: CardStep | null,
): Promise<Reply> {
  const { bindings } = chat;
  const listed = step?.kind === "places" ? step : null;
  const numberOf = /^\d{1,2}$/.exec(text.trim());
  if (listed && listed.places.length > 0 && numberOf) {
    const place = listed.places[Number(numberOf[0]) - 1];
    if (place === undefined) return { text: t("whatsapp.unclear.range", { max: listed.places.length }), step: listed };
    if (place.level === "village") return turn(chat, draft, { kind: "answer", villageCode: place.code });
    return foundPlaces(draft, "", await areaVillages(bindings, place.level, place.code, "", async () => null));
  }
  if (classifyFreeText(text).kind !== "story") return words(chat, draft, text);
  const query = text.trim();
  if (query.length < LENGTHS.placeQuery.min) return unclear(card, t("fieldError.query.tooShort"), listed);
  if (query.length > LENGTHS.placeQuery.max) return unclear(card, t("fieldError.query.tooLong"), listed);
  if (listed?.area) {
    const within = await areaVillages(bindings, listed.area.level, listed.area.code, query, async () => null);
    if (within.kind === "ok" && within.value.items.length > 0) return foundPlaces(draft, query, within);
  }
  return foundPlaces(draft, query, await searchPlaces(bindings, query, async () => null));
}

function foundPlaces(
  draft: DraftRecord,
  query: string,
  found: Awaited<ReturnType<typeof searchPlaces>> | Awaited<ReturnType<typeof areaVillages>>,
): Reply {
  if (found.kind !== "ok") return { text: t("whatsapp.place.unavailable") };
  const { text, places, area } = placesText(found.value, query);
  return { text, step: { kind: "places", revision: draft.revision, places, area } };
}

function counts(chat: Chat, draft: DraftRecord, card: Extract<Card, { kind: "numberForm" }>, text: string) {
  const read = readNumbers(text, card.fields.length);
  if (read.kind === "words") return words(chat, draft, text);
  if (read.kind === "wrongCount")
    return unclear(card, t("whatsapp.unclear.count", { asked: card.fields.length, given: read.given }));
  if (read.kind === "all") return turn(chat, draft, { kind: "answer", optionIds: [read.action] });
  // One not known keeps what the report already holds.
  const values = card.fields.map((field, index) => [field.id, read.values[index] || String(field.value ?? "")]);
  return turn(chat, draft, { kind: "answer", values: Object.fromEntries(values) });
}

function time(
  chat: Chat,
  draft: DraftRecord,
  card: Extract<Card, { kind: "timeCard" }>,
  text: string,
  step: CardStep | null,
) {
  const at = (day: string, hour: string | null, asking: CardStep | null) =>
    turn(
      chat,
      draft,
      {
        kind: "answer",
        optionIds: hour === null && day !== "olderThan30Days" ? [day, "hourUnknown"] : [day],
        values: hour === null ? {} : { hour },
      },
      asking,
    );
  if (step?.kind === "hour") {
    const told = readHour(text);
    if (told) return at(step.day, told.hour, step);
    if (classifyFreeText(text).kind === "story")
      return { text: message(t("fieldError.time.hourFormat"), hourText(card.zone)), step };
    return words(chat, draft, text);
  }
  const choice = readChoice(text, cardChoices(card));
  const told = readDay(text) ?? (choice.kind === "picked" ? { day: choice.ids[0] as string, hour: undefined } : null);
  if (told === null) return words(chat, draft, text);
  if (told.hour !== undefined || told.day === "olderThan30Days") return at(told.day, told.hour ?? null, null);
  return {
    text: hourText(card.zone),
    step: { kind: "hour", revision: draft.revision, day: told.day as "today" | "yesterday" } as const,
  };
}

async function summary(
  chat: Chat,
  draft: DraftRecord,
  card: Extract<Card, { kind: "summary" }>,
  text: string,
  step: CardStep | null,
): Promise<Reply> {
  if (step?.kind === "groups") {
    const read = readChoice(text, groupChoices(card));
    if (read.kind === "picked")
      return turn(chat, draft, { kind: "editGroup", groupId: read.ids[0] as GroupId | "photos" });
    if (read.kind !== "words") return { text: message(notChosen(read), groupsText(card)), step };
    return words(chat, draft, text);
  }
  const read = readChoice(text, cardChoices(card));
  if (read.kind === "words") return words(chat, draft, text);
  if (read.kind !== "picked") return unclear(card, notChosen(read));
  if (read.ids[0] === "send") return send(chat, draft);
  if (read.ids[0] === "cancel") return turn(chat, draft, { kind: "cancel" });
  return { text: groupsText(card), step: { kind: "groups", revision: draft.revision } };
}

const groupsText = (card: Extract<Card, { kind: "summary" }>) =>
  message(t("whatsapp.title", { title: t("whatsapp.edit.title") }), numbered(groupChoices(card)));

// A message read as the answer to the question the draft is at.
async function answerCard(chat: Chat, draft: DraftRecord, text: string): Promise<Reply> {
  const { card } = await viewed(chat, draft);
  const step = cardStepAt(chat.session.step, draft.revision);
  switch (card.kind) {
    case "placeSearch":
      return placeByName(chat, draft, card, text, step);
    case "placeConfirm": {
      const read = readChoice(text, cardChoices(card));
      if (read.kind === "picked")
        return turn(
          chat,
          draft,
          card.nearby === null
            ? { kind: "answer", optionIds: read.ids }
            : { kind: "answer", villageCode: read.ids[0] as string },
        );
      if (read.kind !== "words") return unclear(card, notChosen(read));
      return classifyFreeText(text).kind === "story" ? unclear(card, t("whatsapp.unclear")) : words(chat, draft, text);
    }
    case "neighbourhood": {
      const read = readNeighbourhood(text);
      if (read === "unknown") return turn(chat, draft, { kind: "answer", optionIds: ["unknown"] });
      return read === null ? words(chat, draft, text) : turn(chat, draft, { kind: "answer", values: read });
    }
    case "choice":
    case "multiChoice":
    case "chronologyStep": {
      if (step?.kind === "other" && classifyFreeText(text).kind === "story")
        return turn(chat, draft, { kind: "answer", optionIds: step.picked, values: { other: text } });
      const multiple = card.kind === "multiChoice" || (card.kind === "chronologyStep" && card.multiple);
      return chosen(chat, draft, card, text, multiple);
    }
    case "numberForm":
      return counts(chat, draft, card, text);
    case "timeCard":
      return time(chat, draft, card, text, step);
    case "textQuestion": {
      if (classifyFreeText(text).kind !== "story") return words(chat, draft, text);
      if (saysUnknown(text)) return turn(chat, draft, { kind: "answer", optionIds: ["unknown"] });
      return turn(chat, draft, { kind: "answer", values: { [card.fieldId]: saysSkip(text) ? "" : text } });
    }
    case "chronologyReview": {
      if (readChoice(text, cardChoices(card)).kind === "picked" || saysSkip(text))
        return turn(chat, draft, { kind: "answer", optionIds: ["done"] });
      return classifyFreeText(text).kind === "story"
        ? turn(chat, draft, { kind: "answer", optionIds: ["add"], values: { note: text } })
        : words(chat, draft, text);
    }
    case "summary":
      return summary(chat, draft, card, text, step);
    case "confirm": {
      const read = readChoice(text, cardChoices(card));
      if (read.kind !== "picked") return unclear(card, t("whatsapp.unclear"));
      return turn(chat, draft, { kind: read.ids[0] === "accept" ? "confirm" : "dismiss" });
    }
    default:
      return chosen(chat, draft, card, text, false);
  }
}

function contactText(contact: Extract<Card, { kind: "sent" }>["tracking"]["contact"]): string {
  if (contact.level === "national") return t("card.sent.contact.national");
  return t("whatsapp.sent.contact", {
    who: t(`card.sent.contact.${contact.level}`, { name: contact.name }),
    phone: contact.phone,
  });
}

const trackingLink = (chat: Chat, token: string) =>
  t("whatsapp.sent.track", { link: `${chat.bindings.settings.appOrigin}/lapor/lacak#t=${token}` });

const newsChoices = (): Choice[] => [
  { id: "yes", label: t("whatsapp.wantNews.yes"), means: "yes" },
  { id: "no", label: t("whatsapp.wantNews.no"), means: "no" },
];

const wantNewsText = () => message(t("whatsapp.wantNews"), numbered(newsChoices()), t("whatsapp.hint.one"));

// A version just sent: its document comes to a number that wants news, and a number never asked is
// asked, once (D32). Not answered is no.
async function afterSending(chat: Chat, ticketNumber: string, version: number): Promise<Reply> {
  const { bindings, numberKey } = chat;
  const choice = await newsChoice(bindings.db, numberKey);
  if (choice === "yes") {
    await queueDocument(bindings, ticketNumber, version);
    return { text: t("whatsapp.document.coming", { ticketNumber, version }) };
  }
  if (choice !== null) return { text: "" };
  await addNewsChoice(bindings.db, numberKey, "asked", new Date(chat.nowMs));
  return { text: wantNewsText(), step: { kind: "wantNews", ticketNumber } };
}

async function sentReply(chat: Chat, draftId: string): Promise<Reply> {
  const card = (await viewed(chat, await fresh(chat, draftId))).card as Extract<Card, { kind: "sent" }>;
  const { firstName, ticketNumber } = card;
  const after = await afterSending(chat, ticketNumber, 1);
  const text = message(
    t("whatsapp.sent", { firstName, ticketNumber }),
    t("card.sent.contactPromise"),
    contactText(card.tracking.contact),
    trackingLink(chat, card.trackingToken),
    t("whatsapp.sent.more"),
    after.text,
  );
  return { ...after, text };
}

// Whether news comes to this chat from now on. A yes said again keeps what waits; every no drops it.
async function setNews(chat: Chat, wanted: boolean): Promise<string> {
  const { db } = chat.bindings;
  if (!wanted || (await newsChoice(db, chat.numberKey)) !== "yes")
    await addNewsChoice(db, chat.numberKey, wanted ? "yes" : "no", new Date(chat.nowMs));
  return t(wanted ? "whatsapp.newsOn" : "whatsapp.newsOff");
}

// The newest document of a report, asked for in so many words.
async function askDocument(chat: Chat, ticketNumber: string | null): Promise<string> {
  const { bindings, principal } = chat;
  const [newest] = await myReports(bindings, principal);
  const asked = ticketNumber ?? newest?.ticketNumber;
  if (asked === undefined) return t("whatsapp.document.none");
  if ((await ownedReport(bindings, principal, asked)) === null)
    return t("whatsapp.status.notFound", { ticketNumber: asked });
  const subject = { kind: "numberSlot", numberKey: chat.numberKey, ownerSlot: SESSION_SLOT } as const;
  const refusal = await checkLimits(bindings, [["document.hour", subject]]);
  if (refusal) return t("whatsapp.document.limit", { retryTime: retryWords(chat, refusal.retryAtMs as number) });
  const { versions } = await followUpState(bindings.db, asked);
  await queueDocument(bindings, asked, versions);
  return t("whatsapp.document.coming", { ticketNumber: asked, version: versions });
}

async function send(chat: Chat, draft: DraftRecord): Promise<Reply> {
  const { bindings } = chat;
  const key = crypto.randomUUID();
  const answer = await sendDraft(bindings, chat.principal, draft.id, draft.revision, key, key);
  switch (answer.kind) {
    case "ok": {
      const ticketNumber = draft.followUpOf;
      if (ticketNumber === null) return sentReply(chat, draft.id);
      const { versions: version } = await followUpState(bindings.db, ticketNumber);
      const after = await afterSending(chat, ticketNumber, version);
      return { ...after, text: message(t("whatsapp.news.sent", { ticketNumber, version }), after.text) };
    }
    case "failed":
      return { text: message(t("whatsapp.failed"), cardText(answer.draft.card)) };
    case "followUpClosed":
      return { text: message(t(`followUp.closed.${answer.reason}`), cardText(answer.draft.card)) };
    case "limit": {
      const retryTime = retryWords(chat, answer.refusal.retryAtMs as number);
      return { text: message(t("whatsapp.limit.send", { retryTime }), cardText(answer.draft.card)) };
    }
    default:
      return worded(chat, draft, answer, "answer", null);
  }
}

const menu = () => t("whatsapp.menu", { appName: t("app.name") });

const identityChoices = (step: IdentityStep): Choice[] =>
  step.kind === "consent"
    ? [
        { id: "agree", label: t("consent.agree"), means: "yes" },
        { id: "decline", label: t("consent.decline"), means: "no" },
      ]
    : [
        { id: "citizen", label: t("identity.role.citizen") },
        { id: "claimedOfficer", label: t("identity.role.officer") },
      ];

function identityText(chat: Chat, step: IdentityStep): string {
  switch (step.kind) {
    case "consent":
      return message(
        t("consent.text"),
        numbered(identityChoices(step)),
        t("whatsapp.consent.privacy", { link: `${chat.bindings.settings.appOrigin}/lapor/privacy` }),
      );
    case "role":
      return message(
        t("whatsapp.title", { title: t("whatsapp.role.title") }),
        numbered(identityChoices(step)),
        t("whatsapp.hint.one"),
      );
    default:
      return t(`whatsapp.${step.kind}.ask`);
  }
}

// An unknown number is told who is asking and what its data is for, and asked to agree.
function welcome(chat: Chat, emergency: boolean, told: boolean): Reply {
  const step: IdentityStep = { kind: "consent", emergency };
  return {
    text: message(
      t("whatsapp.welcome", { appName: t("app.name"), greeting: t("chat.greeting") }),
      t("notice.lifeLine"),
      told && t("whatsapp.consent.notKept"),
      identityText(chat, step),
    ),
    step,
  };
}

const knownLine = (profile: Pick<ProfileRow, "name" | "role">) =>
  t("whatsapp.known", {
    name: profile.name,
    role: t(profile.role === "citizen" ? "identity.role.citizen" : "identity.role.officer"),
  });

// A known reporter under another name. Their consent stands, and what is open goes on.
async function renamed(chat: Chat, profile: ProfileRow, identity: Identity): Promise<Reply> {
  await run(chat.bindings.db, updateProfile(profile.id, identity, new Date(chat.nowMs)));
  const { draft } = await currentDraft(chat);
  return { text: message(knownLine(identity), draft === null ? menu() : await againOf(chat, draft)) };
}

async function identityReply(chat: Chat, step: IdentityStep, text: string): Promise<Reply> {
  const ask = identityText(chat, step);
  if (classifyFreeText(text).kind === "cancel")
    return { text: t(chat.profile === null ? "whatsapp.identity.cancelled" : "whatsapp.identity.kept") };
  if (readCommand(text)?.kind === "help") return { text: message(t("whatsapp.help"), ask), step };
  const move = identityMove(step, text, identityChoices(step), chat.nowMs);
  switch (move.kind) {
    case "ask":
      return { text: identityText(chat, move.step), step: move.step };
    case "declined":
      return { text: t("whatsapp.consent.declined") };
    case "unclear":
      return { text: message(t("whatsapp.unclear"), ask), step };
    case "invalid":
      return { text: message(t(`fieldError.${move.rule}`, move.params), ask), step };
    default: {
      // Each part was checked as it was answered, and the number by the gateway's route.
      const { identity } = checkIdentity({ ...move.identity, number: chat.number }) as { identity: Identity };
      if (chat.profile !== null) return renamed(chat, chat.profile, identity);
      const agreedAt = new Date(move.agreedAtMs);
      const given = await giveConsent(chat.bindings, chat.principal, identity, move.emergency, agreedAt);
      // A chat has no device to be full.
      const { draftId } = given as Extract<typeof given, { kind: "draft" }>;
      return { text: message(knownLine(identity), await cardOf(chat, await fresh(chat, draftId))) };
    }
  }
}

// An emergency takes the place of news not sent yet, which is the only report open beside it.
async function begun(chat: Chat, profile: ProfileRow, emergency: boolean) {
  const started = await startDraft(chat.bindings, chat.principal, profile.id, emergency, null, emergency);
  const { draftId } = started as Extract<typeof started, { draftId: string }>;
  return { draft: await fresh(chat, draftId), lead: message(knownLine(profile), t("notice.lifeLine")) };
}

// A report under the name known for this number, or who they are first. Words told are read at once.
async function startReport(chat: Chat, emergency: boolean, told: string): Promise<Reply> {
  if (chat.profile === null) return welcome(chat, emergency, told !== "");
  const { draft, lead } = await begun(chat, chat.profile, emergency);
  if (told === "") return { text: message(lead, await cardOf(chat, draft)) };
  const read = await words(chat, draft, told);
  return { ...read, text: message(lead, read.text) };
}

const RECENT_REPORTS = 5;

// The tickets of this chat that may still be told news of, the newest first.
async function openToNews(chat: Chat) {
  const reports = (await myReports(chat.bindings, chat.principal)).slice(0, RECENT_REPORTS);
  const states = await Promise.all(reports.map((one) => followUpState(chat.bindings.db, one.ticketNumber)));
  return reports.filter((_, index) => {
    const state = states[index] as (typeof states)[number];
    return followUpRefusal({ ...state, sentAtMs: state.sentAt.getTime() }, chat.nowMs) === null;
  });
}

async function aboutTicket(chat: Chat, step: TicketStep): Promise<Reply> {
  return { text: aboutText(await aboutChoices(chat, step)), step };
}

async function aboutChoices(chat: Chat, step: TicketStep): Promise<Choice[]> {
  const reports = await myReports(chat.bindings, chat.principal);
  const hazardOf = (ticketNumber: string) =>
    t(hazardKey(reports.find((one) => one.ticketNumber === ticketNumber)?.hazardType as string));
  return [
    ...step.tickets.map((ticketNumber) => ({
      id: ticketNumber,
      label: t("whatsapp.aboutTicket.ticket", { ticketNumber, hazard: hazardOf(ticketNumber) }),
    })),
    ...(step.mayBeNew ? [{ id: "new", label: t("whatsapp.aboutTicket.new") }] : []),
  ];
}

const aboutText = (choices: readonly Choice[]) =>
  message(t("whatsapp.title", { title: t("whatsapp.aboutTicket.title") }), numbered(choices), t("whatsapp.hint.one"));

async function news(chat: Chat, ticketNumber: string, told: string): Promise<Reply> {
  const started = await startFollowUp(chat.bindings, chat.principal, ticketNumber);
  switch (started.kind) {
    case "draft": {
      const draft = await fresh(chat, started.draftId);
      return told === "" ? { text: await cardOf(chat, draft) } : words(chat, draft, told);
    }
    case "notFound":
      return { text: t("whatsapp.status.notFound", { ticketNumber }) };
    case "closed":
      return { text: t(`followUp.closed.${started.reason}`) };
    case "openExists":
      return { text: message(t("whatsapp.news.finishFirst"), await cardOf(chat, await fresh(chat, started.draftId))) };
    default:
      return { text: t("whatsapp.limit", { retryTime: retryWords(chat, started.refusal.retryAtMs as number) }) };
  }
}

async function addNews(chat: Chat, ticketNumber: string | null, told: string): Promise<Reply> {
  if (ticketNumber !== null) return news(chat, ticketNumber, told);
  const tickets = (await openToNews(chat)).map((one) => one.ticketNumber);
  const [only, ...others] = tickets;
  if (only === undefined) return { text: t("whatsapp.news.noReport") };
  if (others.length === 0) return news(chat, only, told);
  return aboutTicket(chat, { kind: "aboutTicket", tickets, mayBeNew: false, text: told });
}

async function statusText(chat: Chat, ticketNumber: string | null): Promise<string> {
  const reports = await myReports(chat.bindings, chat.principal);
  const row = (one: (typeof reports)[number]) =>
    t("whatsapp.status.row", {
      ticketNumber: one.ticketNumber,
      hazard: t(hazardKey(one.hazardType)),
      at: longDate(one.sentAt),
      status: t(`stage.long.${one.status}`),
    });
  if (ticketNumber !== null) {
    const one = reports.find((report) => report.ticketNumber === ticketNumber);
    const own = await ownedReport(chat.bindings, chat.principal, ticketNumber);
    if (one === undefined || own === null) return t("whatsapp.status.notFound", { ticketNumber });
    return message(row(one), await latestNews(chat.bindings, own), trackingLink(chat, one.trackingToken));
  }
  const [newest] = reports;
  if (newest === undefined) return t("whatsapp.status.none");
  const older = reports.length - RECENT_REPORTS;
  return message(
    t("whatsapp.title", { title: t("whatsapp.status.title") }),
    ...reports.slice(0, RECENT_REPORTS).map(row),
    older > 0 && t("whatsapp.status.more", { count: older }),
    t("whatsapp.status.hint", { ticketNumber: newest.ticketNumber }),
  );
}

// Who reports, asked again of a reporter who has agreed before.
function changeIdentity(chat: Chat): Reply {
  const step: IdentityStep = { kind: "role", agreedAtMs: chat.nowMs, emergency: false };
  return { text: identityText(chat, step), step };
}

async function commandInDraft(chat: Chat, draft: DraftRecord, command: Command): Promise<Reply> {
  const again = () => againOf(chat, draft);
  switch (command.kind) {
    case "help":
      return { text: message(t("whatsapp.help"), await again()) };
    case "start":
      return { text: message(t("whatsapp.resume"), await again()) };
    case "status":
      return { text: message(await statusText(chat, command.ticketNumber), await again()) };
    case "document":
      return { text: message(await askDocument(chat, command.ticketNumber), await again()) };
    case "newsStop":
    case "newsStart":
      return { text: message(await setNews(chat, command.kind === "newsStart"), await again()) };
    case "identity":
      return changeIdentity(chat);
    case "addNews":
      return draft.followUpOf !== null && (command.ticketNumber ?? draft.followUpOf) === draft.followUpOf
        ? { text: await again() }
        : { text: message(t("whatsapp.news.finishFirst"), await again()) };
    case "emergency": {
      // News not sent yet never stands in for an emergency.
      if (draft.followUpOf !== null) return startReport(chat, true, "");
      await run(chat.bindings.db, makeEmergency(draft.id));
      const now = await fresh(chat, draft.id);
      return { text: message(t("whatsapp.emergency.now"), t("notice.lifeLine"), await cardOf(chat, now)) };
    }
    default:
      return { text: await cardOf(chat, draft) };
  }
}

async function commandIdle(chat: Chat, command: Command): Promise<Reply> {
  switch (command.kind) {
    case "start":
      return startReport(chat, false, "");
    case "emergency":
      return startReport(chat, true, "");
    case "status":
      return { text: await statusText(chat, command.ticketNumber) };
    case "document":
      return { text: await askDocument(chat, command.ticketNumber) };
    case "newsStop":
    case "newsStart":
      return { text: await setNews(chat, command.kind === "newsStart") };
    case "identity":
      return changeIdentity(chat);
    case "addNews":
      return addNews(chat, command.ticketNumber, "");
    default:
      return { text: menu() };
  }
}

// The answer to whether news may come; a yes brings the document of the report it was asked after.
async function wantNews(chat: Chat, ticketNumber: string, wanted: boolean): Promise<Reply> {
  const said = await setNews(chat, wanted);
  return { text: wanted ? message(said, await askDocument(chat, ticketNumber)) : said };
}

async function idle(chat: Chat, text: string): Promise<Reply> {
  const { step } = chat.session;
  if (step?.kind === "aboutTicket") {
    const choices = await aboutChoices(chat, step);
    const read = readChoice(text, choices);
    if (read.kind === "picked")
      return read.ids[0] === "new" ? startReport(chat, false, step.text) : news(chat, read.ids[0] as string, step.text);
    if (read.kind !== "words") return { text: message(notChosen(read), aboutText(choices)), step };
  }
  if (step?.kind === "wantNews") {
    const read = readChoice(text, newsChoices());
    if (read.kind === "picked") return wantNews(chat, step.ticketNumber, read.ids[0] === "yes");
    if (read.kind !== "words") return { text: message(notChosen(read), wantNewsText()), step };
  }
  if (chat.profile === null) return welcome(chat, false, tellsOfEvent(text));
  const named = newsWithTicket(text);
  if (named) return addNews(chat, named.ticketNumber, named.rest);
  if (!tellsOfEvent(text)) return { text: menu() };
  const tickets = (await openToNews(chat)).map((one) => one.ticketNumber);
  if (tickets.length === 0) return startReport(chat, false, text);
  const told = maskText(text, { name: chat.profile.name, number: chat.number });
  return aboutTicket(chat, { kind: "aboutTicket", tickets, mayBeNew: true, text: told });
}

async function respond(chat: Chat, text: string): Promise<Reply> {
  const { step } = chat.session;
  if (step && isIdentityStep(step)) return identityReply(chat, step, text);
  const command = readCommand(text);
  const { draft, expired } = await currentDraft(chat);
  if (draft !== null) return command ? commandInDraft(chat, draft, command) : answerCard(chat, draft, text);
  // A number nobody agreed for has no reports: any command of it but an emergency starts there.
  const reply =
    command && (chat.profile !== null || command.kind === "emergency" || command.kind === "start")
      ? await commandIdle(chat, command)
      : await idle(chat, text);
  return expired ? { ...reply, text: message(t("whatsapp.expired"), reply.text) } : reply;
}

// A location shared in the chat: the place of the report, or of its photos.
async function located(chat: Chat, point: Point): Promise<Reply> {
  const { step } = chat.session;
  if (step && isIdentityStep(step)) return { text: message(t("whatsapp.unclear"), identityText(chat, step)), step };
  const shared: SharedPoint = { ...point, atMs: chat.nowMs };
  let { draft } = await currentDraft(chat);
  let lead = "";
  if (draft === null) {
    if (chat.profile === null) return welcome(chat, false, true);
    ({ draft, lead } = await begun(chat, chat.profile, false));
  }
  if (draft.state === "place" || draft.state === "place_confirm") {
    const values = { lat: String(point.lat), lon: String(point.lon) };
    const read = await turn(chat, draft, { kind: "locate", values });
    return { ...read, text: message(lead, read.text), shared };
  }
  if (draft.state !== "photos")
    return { text: message(t("whatsapp.location.notNow"), await againOf(chat, draft)), shared };
  const placed = await placePhotos(chat.bindings, draft, shared);
  await touchDraft(chat.bindings.db, draft.id, new Date(chat.nowMs));
  const said = placed > 0 ? t("whatsapp.location.photos", { count: placed }) : t("whatsapp.location.kept");
  return { text: message(said, await cardOf(chat, draft)), shared };
}

export type ChatMessage = { readonly text: string } | { readonly point: Point };

// One message of a number. The number is in its stored form, as the gateway's route read it.
export async function chatMessage(bindings: ServiceBindings, number: string, sent: ChatMessage): Promise<ChatAnswer> {
  const chat = await openChat(bindings, number);
  if (chat === null) return { kind: "notAllowed" };
  const refused = await overLimit(chat);
  if (refused) return refused;
  const reply = "point" in sent ? await located(chat, sent.point) : await respond(chat, sent.text);
  return { kind: "reply", text: await settled(chat, reply) };
}

const PHOTO_TRIES = 3;

// A photo of the chat, in the photo step. Photos sent together land one after another.
export async function chatPhoto(
  bindings: ServiceBindings,
  number: string,
  bytes: Uint8Array,
  sentAtMs: number,
): Promise<ChatAnswer> {
  const chat = await openChat(bindings, number);
  if (chat === null) return { kind: "notAllowed" };
  const refused = await overLimit(chat);
  if (refused) return refused;
  const { step, shared } = chat.session;
  if (step && isIdentityStep(step))
    return { kind: "notNow", text: message(t("whatsapp.unclear"), identityText(chat, step)) };
  const { draft } = await currentDraft(chat);
  if (draft === null) {
    const reply = chat.profile === null ? welcome(chat, false, true) : { text: t("whatsapp.photo.noReport") };
    return { kind: "notNow", text: await settled(chat, reply) };
  }
  let answer: Answer = { kind: "notFound" };
  for (let tries = 0, now = draft; tries < PHOTO_TRIES; tries += 1, now = await fresh(chat, draft.id)) {
    const key = crypto.randomUUID();
    const upload = { revision: now.revision, turnKey: key, bytes, device: null, offsetMinutes: null };
    answer = await addPhoto(bindings, chat.principal, null, draft.id, { ...upload, chat: { sentAtMs, shared } }, key);
    if (answer.kind !== "changed") break;
  }
  if (answer.kind === "invalid") {
    const rule = (answer.errors[0] as { rule: string }).rule;
    return { kind: "notNow", text: message(t(`whatsapp.${rule}`), askedAgain(answer.draft.card)) };
  }
  return { kind: "reply", text: (await worded(chat, draft, answer, "answer", null)).text };
}
