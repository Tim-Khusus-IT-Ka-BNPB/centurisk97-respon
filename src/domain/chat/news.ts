import type { TicketStatus } from "../stages";
import { DAY_MS } from "../time";

// What staff did about a report as one message of its chat: the things of one act are told together.

// News a gateway never came for is not sent after this long.
export const NEWS_WAITS_MS = 7 * DAY_MS;

// The most lines of one kind a message lists; a document's caption holds no more.
export const NEWS_LINES = 8;

export type NoticeRow = {
  readonly id: number;
  readonly ticketNumber: string;
  readonly atMs: number;
  readonly kind: "status" | "reply" | "actions" | "correction" | "document";
  readonly status: TicketStatus | null;
  // An officer's note is told only as the reason a report is set aside.
  readonly note: string | null;
  readonly actions: readonly string[];
  readonly reply: string | null;
  // The version a check made, or the document asked for.
  readonly version: number | null;
};

export type NewsMessage = {
  // The first notice it tells, which names the message to the gateway.
  readonly id: number;
  readonly ticketNumber: string;
  readonly atMs: number;
  readonly status: { readonly status: TicketStatus; readonly reason: string | null } | null;
  readonly actions: readonly string[];
  readonly reply: string | null;
  // The version with what a check put right.
  readonly corrected: number | null;
  // The version a document was asked for.
  readonly document: number | null;
};

const EMPTY = { status: null, actions: [], reply: null, corrected: null, document: null } as const;

function told(message: NewsMessage, row: NoticeRow): NewsMessage {
  switch (row.kind) {
    case "status": {
      // Of several steps taken at once the last is where the ticket stands.
      const status = row.status as TicketStatus;
      return { ...message, status: { status, reason: status === "invalid" ? row.note : null } };
    }
    case "actions":
      return { ...message, actions: [...message.actions, ...row.actions] };
    case "reply":
      return { ...message, reply: row.reply };
    case "correction":
      return { ...message, corrected: row.version };
    default:
      return { ...message, document: row.version };
  }
}

// The messages that wait, oldest first, from notices in the order they were written.
export function newsMessages(rows: readonly NoticeRow[]): NewsMessage[] {
  const messages = new Map<string, NewsMessage>();
  for (const row of rows) {
    const key = `${row.ticketNumber} ${row.atMs}`;
    const begun = messages.get(key) ?? { id: row.id, ticketNumber: row.ticketNumber, atMs: row.atMs, ...EMPTY };
    messages.set(key, told(begun, row));
  }
  return [...messages.values()];
}

// The first lines of a list, and how many are left out.
export const firstLines = <T>(lines: readonly T[]): { readonly shown: readonly T[]; readonly left: number } => ({
  shown: lines.slice(0, NEWS_LINES),
  left: Math.max(0, lines.length - NEWS_LINES),
});
