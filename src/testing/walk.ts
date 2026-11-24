import { expect } from "vitest";
import type { Card } from "../contract/card";
import type { DraftBody } from "../contract/draft";
import type { browser } from "./api";

type Phone = ReturnType<typeof browser>;
type Overrides = Partial<Record<Card["kind"] | string, (card: Card) => Record<string, unknown> | null>>;

// The default answer to each card, as the plain walk of a report with the model off taps it.
export function defaultAnswer(card: Card, villageCode: string): Record<string, unknown> | null {
  switch (card.kind) {
    case "placeSearch":
    case "regencyVillages":
      return { villageCode };
    case "neighbourhood":
    case "textQuestion":
      return { optionIds: ["unknown"] };
    case "choice":
      return { optionIds: [(card.options[0] as { id: string }).id] };
    case "chronologyStep":
      return { optionIds: [(card.options[0] as { id: string }).id] };
    case "multiChoice":
      return { optionIds: ["unknown"] };
    case "chronologyReview":
      return { optionIds: ["done"] };
    case "timeCard":
      return { optionIds: ["today", "hourUnknown"] };
    case "numberForm":
      return { optionIds: ["allNone"] };
    case "photos":
      return { optionIds: ["cannotSend"] };
    default:
      return null;
  }
}

export const turn = (draft: DraftBody, body: Record<string, unknown>) => ({
  revision: draft.revision,
  turnKey: crypto.randomUUID(),
  cardId: draft.card.cardId,
  kind: "answer",
  ...body,
});

// Answers card after card until the summary (or a card the overrides stop at), and returns the draft there.
type WalkOptions = {
  readonly overrides?: Overrides;
  readonly stopAt?: (draft: DraftBody) => boolean;
  // Moves the test clock between turns, as a person takes a few seconds per card.
  readonly tick: () => void;
};

const atSummary = (draft: DraftBody) => draft.card.kind === "summary";

export async function walkTo(
  phone: Phone,
  start: DraftBody,
  villageCode: string,
  options: WalkOptions,
): Promise<{ draft: DraftBody; turns: number }> {
  const { overrides = {}, stopAt = atSummary, tick } = options;
  let draft = start;
  let turns = 0;
  while (!stopAt(draft)) {
    tick();
    const pick =
      overrides[`${draft.card.kind}:${"fieldId" in draft.card ? draft.card.fieldId : ""}`] ??
      overrides[draft.card.kind];
    const body = (pick ?? ((card: Card) => defaultAnswer(card, villageCode)))(draft.card);
    expect(body, draft.card.kind).not.toBeNull();
    const answer = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(draft, body as Record<string, unknown>),
    );
    expect(answer.status, `${draft.card.kind} ${JSON.stringify(answer.error.error ?? answer.error)}`).toBe(200);
    draft = answer.draft;
    turns += 1;
    expect(turns).toBeLessThan(80);
  }
  return { draft, turns };
}

// A typed number's consent, or a new draft from a profile already on this device.
export async function startDraft(phone: Phone, number: string, name = "Uji Satu"): Promise<DraftBody> {
  const answer = await phone.call("POST", "/consent", {
    role: "citizen",
    name,
    number,
    privacyVersion: 1,
    agree: true,
  });
  if (answer.status === 201) return answer.draft;
  const me = await phone.call("GET", "/me");
  const profileId = (me.json as { knownReporters: { profileId: string }[] }).knownReporters[0]?.profileId;
  return (await phone.call("POST", "/drafts", { profileId, replaceOpenDraft: true })).draft;
}

// Walks a started draft to the summary and sends it; answers the ticket number.
export async function sendDraft(
  phone: Phone,
  started: DraftBody,
  villageCode: string,
  options: WalkOptions,
): Promise<string> {
  const { draft } = await walkTo(phone, started, villageCode, options);
  const sent = await phone.call("POST", `/drafts/${draft.draftId}/send`, {
    revision: draft.revision,
    turnKey: crypto.randomUUID(),
  });
  expect(sent.status, JSON.stringify(sent.json)).toBe(201);
  return (sent.json as { ticketNumber: string }).ticketNumber;
}
