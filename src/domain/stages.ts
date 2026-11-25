// The handling stages a reporter sees (K52), read from the ticket's history alone, so a stage is
// never shown as done before its history row exists.

export type TicketStatus = "new" | "seen" | "under_review" | "forwarded" | "in_handling" | "closed" | "invalid";

const ALWAYS = ["new", "seen", "under_review", "in_handling", "closed"] as const;

export type Stage = { readonly status: TicketStatus; readonly reachedAtMs: number | null };

export type HistoryRow = { readonly toStatus: TicketStatus; readonly atMs: number };

// A report set aside, with the reason its officer wrote for the reporter; null once reopened.
export function rejectionOf<T extends HistoryRow>(history: readonly T[]): T | null {
  const last = [...history].sort((a, b) => a.atMs - b.atMs).at(-1);
  return last?.toStatus === "invalid" ? last : null;
}

const PAST_REVIEW = ["forwarded", "in_handling", "closed"] as const;

// The five stages, each with the time it was first reached or null; "forwarded" joins after
// "under_review" only once it happened. A reopened ticket is back at its review: the stages past
// it are ahead again. Setting a report aside is no stage (see rejectionOf).
export function stagesOf(history: readonly HistoryRow[]): Stage[] {
  const first = new Map<TicketStatus, number>();
  for (const row of [...history].sort((a, b) => a.atMs - b.atMs)) {
    if (row.toStatus === "under_review") for (const later of PAST_REVIEW) first.delete(later);
    if (!first.has(row.toStatus)) first.set(row.toStatus, row.atMs);
  }
  const shown: TicketStatus[] = [...ALWAYS];
  if (first.has("forwarded")) shown.splice(shown.indexOf("in_handling"), 0, "forwarded");
  return shown.map((status) => ({ status, reachedAtMs: first.get(status) ?? null }));
}
