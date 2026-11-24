import { DRAFT_LIFE_MS, type DraftRecord, type TranscriptRow } from "../adapters/d1/drafts";
import type { PhotoRecord } from "../adapters/d1/photos";
import type { Card } from "../contract/card";
import type { DraftBody } from "../contract/draft";
import { isFinal } from "../domain/draftStates";
import { provinceZone, type Zone } from "../domain/eventTime";
import { completePercent } from "../domain/fields/applicable";
import type { ReporterRole } from "../domain/identityForm";
import { EMPTY_CONTENT } from "../domain/turn/content";
import { currentQuestion } from "../domain/turn/engine";
import { cardFor } from "./cards";

export type Notice = DraftBody["notices"][number];
export const LIFE_LINE: Notice = { kind: "lifeLine", copyKey: "notice.lifeLine", params: {}, retryAt: null };
const RESUMED: Notice = { kind: "resumed", copyKey: "notice.resumed", params: {}, retryAt: null };

// What a read of an open draft shows: the notices the last turn left for it, once; or, when the
// reporter comes back to the draft later, the 112 line at the top and the resumed signal.
export function noticesOnRead(pending: readonly Notice[] | null): readonly Notice[] {
  return pending ?? [LIFE_LINE, RESUMED];
}

export const at = (ms: number | Date, zone: Zone) => ({ utc: new Date(ms).toISOString(), zone });

export function draftZone(villageCode: string | null): Zone {
  return provinceZone(villageCode === null ? null : villageCode.slice(0, 2));
}

type SentTicket = { readonly ticketNumber: string; readonly sentAt: Date };

type ViewInput = {
  readonly draft: DraftRecord;
  readonly transcript: readonly TranscriptRow[];
  readonly notices: readonly Notice[];
  readonly turnKey: string | null;
  readonly nowMs: number;
  readonly ticket: SentTicket | null;
  readonly photos: readonly PhotoRecord[];
};

function endedCard(ticket: SentTicket | null, cardId: string): Card {
  if (ticket)
    return {
      cardId,
      kind: "sent",
      titleKey: "card.sent.title",
      promptKey: "card.sent.body",
      params: { ticketNumber: ticket.ticketNumber },
      ticketNumber: ticket.ticketNumber,
      sentAt: at(ticket.sentAt, "WIB"),
    };
  return { cardId, kind: "cancelled", titleKey: "card.cancelled.title", promptKey: "card.cancelled.body", params: {} };
}

// The draft as the client draws it: the card code picked, the conversation so far and the notices.
export function draftView(input: ViewInput): DraftBody {
  const { draft } = input;
  const zone = draftZone(draft.villageCode);
  const content = draft.content ?? EMPTY_CONTENT;
  const final = isFinal(draft.state);
  const cardId = `c-${draft.revision}`;
  const percent = completePercent(content.states);
  const card = final
    ? endedCard(input.ticket, cardId)
    : cardFor(currentQuestion({ state: draft.state, content, asked: draft.asked }), content, {
        cardId,
        nowMs: input.nowMs,
        zone,
        // An open draft always has its profile: removing a profile ends its draft.
        reporter: { name: draft.name as string, role: draft.role as ReporterRole },
        completePercent: percent,
        asked: draft.asked,
        photos: input.photos,
      });
  return {
    draftId: draft.id,
    revision: draft.revision,
    state: draft.state,
    card,
    transcript: input.transcript.map((row) =>
      row.speaker === "reporter"
        ? { speaker: "reporter", textMasked: row.text_masked as string, at: at(row.created_at, zone) }
        : {
            speaker: "assistant",
            cardKind: row.card_kind,
            copyKey: row.copy_key as string,
            promptKey: row.prompt_key,
            params: row.params as Record<string, string | number>,
            at: at(row.created_at, zone),
          },
    ),
    notices: [...input.notices],
    completePercent: final ? 0 : percent,
    keptUntil: at(draft.lastActedAt.getTime() + DRAFT_LIFE_MS, zone),
    canGoBack: !final && (draft.backStack.length > 0 || content.overlay !== null),
    freeTextAllowed: !final,
    turnKey: input.turnKey,
  };
}
