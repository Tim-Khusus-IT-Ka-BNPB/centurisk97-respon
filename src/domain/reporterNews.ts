import type { TicketStatus } from "./stages";

// What staff did that a reporter is told (K19, D20). An officer is never named, and of their notes
// only the reason a report was set aside is told.

export type HistoryNews = {
  readonly actor: "system" | "staff" | "reporter";
  readonly event: "fieldCheck" | "actions" | "take" | "followUp" | null;
  readonly fromStatus: TicketStatus | null;
  readonly toStatus: TicketStatus;
  readonly note: string | null;
  readonly actions: readonly string[];
  readonly atMs: number;
};

export type NewsItem =
  | { readonly kind: "status"; readonly atMs: number; readonly status: TicketStatus; readonly reason: string | null }
  | { readonly kind: "reply"; readonly atMs: number; readonly text: string }
  | { readonly kind: "actions"; readonly atMs: number; readonly actions: readonly string[] }
  | { readonly kind: "correction"; readonly atMs: number; readonly version: number };

function fromHistory(row: HistoryNews): NewsItem[] {
  if (row.actor !== "staff") return [];
  if (row.event === "actions") return [{ kind: "actions", atMs: row.atMs, actions: row.actions }];
  // Who has a report in hand is no news, and a check that moved nothing is the desk's own.
  if (row.event === "take" || row.fromStatus === row.toStatus) return [];
  const reason = row.toStatus === "invalid" ? row.note : null;
  return [{ kind: "status", atMs: row.atMs, status: row.toStatus, reason }];
}

// A report's news, the newest first; of things done at once, the last one done comes first.
export function reporterNews(
  history: readonly HistoryNews[],
  replies: readonly { readonly text: string; readonly atMs: number }[],
  corrections: readonly { readonly version: number; readonly atMs: number }[],
): NewsItem[] {
  return [
    ...history.flatMap(fromHistory),
    ...corrections.map(({ version, atMs }) => ({ kind: "correction", version, atMs }) as const),
    ...replies.map(({ text, atMs }) => ({ kind: "reply", text, atMs }) as const),
  ]
    .reverse()
    .sort((a, b) => b.atMs - a.atMs);
}

// News since the reporter last read it; none is new while they stopped it.
export const isUnread = (atMs: number, readAtMs: number | null, stopped: boolean): boolean =>
  !stopped && atMs > (readAtMs ?? Number.NEGATIVE_INFINITY);
