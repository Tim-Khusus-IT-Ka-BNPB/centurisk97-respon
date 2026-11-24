// The handling stages a reporter sees (K52), read from the ticket's history alone, so a stage is
// never shown as done before its history row exists.

export type TicketStatus = "new" | "seen" | "under_review" | "forwarded" | "in_handling" | "closed" | "invalid";

const ALWAYS = ["new", "seen", "under_review", "in_handling", "closed"] as const;

export type Stage = { readonly status: TicketStatus; readonly reachedAtMs: number | null };

export type HistoryRow = { readonly toStatus: TicketStatus; readonly atMs: number };

// The five stages, each with the time it was first reached or null; "forwarded" joins after
// "under_review" only once it happened.
export function stagesOf(history: readonly HistoryRow[]): Stage[] {
  const first = new Map<TicketStatus, number>();
  for (const row of [...history].sort((a, b) => a.atMs - b.atMs))
    if (!first.has(row.toStatus)) first.set(row.toStatus, row.atMs);
  const shown: TicketStatus[] = [...ALWAYS];
  if (first.has("forwarded")) shown.splice(shown.indexOf("in_handling"), 0, "forwarded");
  return shown.map((status) => ({ status, reachedAtMs: first.get(status) ?? null }));
}
