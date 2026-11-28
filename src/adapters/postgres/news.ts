import type { HistoryNews } from "../../domain/reporterNews";
import type { TicketStatus } from "../../domain/stages";
import { type Database, empty, previousChangedOne, type Query, row, rows, run, sql } from "../../platform/database";

// News for a reporter is written unless they stopped it.
const LISTENING = (ticketNumber: string): Query =>
  sql`not exists (select 1 from report_news w join report r on r.id = w.report_id
    where r.ticket_number = ${ticketNumber} and w.stopped)`;

// The notice of the history row the batch has just written. `when` narrows it to a row that did
// go in, right after the statement that writes it.
export const historyNotice = (
  ticketNumber: string,
  kind: "status" | "actions" | "correction",
  at: Date,
  when: Query = empty,
): Query =>
  sql`insert into notice (ticket_number, kind, history_id, at)
    select ${ticketNumber}, ${kind}, (select max(id) from ticket_history where ticket_number = ${ticketNumber}), ${at}
    where ${LISTENING(ticketNumber)}${when}`;

// Only when the history row before it was written.
export const IF_WRITTEN: Query = sql` and ${previousChangedOne}`;

export const replyNotice = (ticketNumber: string, at: Date): Query =>
  sql`insert into notice (ticket_number, kind, reply_id, at)
    select ${ticketNumber}, 'reply', (select max(id) from report_reply where ticket_number = ${ticketNumber}), ${at}
    where ${LISTENING(ticketNumber)}`;

// How many notices of a report its reporter has not read, for a list of reports.
export const UNREAD: Query = sql`(select count(*) from notice n where n.ticket_number = r.ticket_number
    and n.at > coalesce(w.read_at, '-infinity') and not coalesce(w.stopped, false))`;

export type NewsState = { readonly readAtMs: number | null; readonly stopped: boolean };

export async function newsState(db: Database, ticketNumber: string): Promise<NewsState> {
  const found = await row<{ read_at: string; stopped: boolean }>(
    db,
    sql`select w.read_at, w.stopped from report_news w join report r on r.id = w.report_id
      where r.ticket_number = ${ticketNumber}`,
  );
  return found === null
    ? { readAtMs: null, stopped: false }
    : { readAtMs: Date.parse(found.read_at), stopped: found.stopped === true };
}

// What staff answered the reporter, oldest first, without who wrote it.
export async function repliesOf(db: Database, ticketNumber: string): Promise<{ text: string; atMs: number }[]> {
  const found = await rows<{ text: string; at: string }>(
    db,
    sql`select text, at from report_reply where ticket_number = ${ticketNumber} order by at, id`,
  );
  return found.map((one) => ({ text: one.text, atMs: Date.parse(one.at) }));
}

// What was written about a report that its news is made from, oldest first.
export async function newsSources(
  db: Database,
  ticketNumber: string,
): Promise<{ history: HistoryNews[]; replies: { text: string; atMs: number }[] }> {
  const [history, replies] = await Promise.all([
    rows<{
      actor: HistoryNews["actor"];
      event: HistoryNews["event"];
      from_status: TicketStatus | null;
      to_status: TicketStatus;
      note: string | null;
      detail: { actions?: string[] } | null;
      at: string;
    }>(
      db,
      sql`select actor, event, from_status, to_status, note, detail, at from ticket_history
        where ticket_number = ${ticketNumber} order by at, id`,
    ),
    repliesOf(db, ticketNumber),
  ]);
  return {
    history: history.map((one) => ({
      actor: one.actor,
      event: one.event,
      fromStatus: one.from_status,
      toStatus: one.to_status,
      note: one.note,
      actions: (one.detail as { actions?: string[] } | null)?.actions ?? [],
      atMs: Date.parse(one.at),
    })),
    replies,
  };
}

// The reporter read the news up to now.
export async function markNewsRead(db: Database, reportId: string, at: Date): Promise<void> {
  await run(
    db,
    sql`insert into report_news (report_id, read_at, changed_at) values (${reportId}, ${at}, ${at})
      on conflict (report_id) do update set read_at = excluded.read_at, changed_at = excluded.changed_at`,
  );
}

// The reporter stopped the news, or wants it again. What came while it was stopped is not new.
export async function setNewsStopped(db: Database, reportId: string, stopped: boolean, at: Date): Promise<void> {
  await run(
    db,
    sql`insert into report_news (report_id, read_at, stopped, changed_at) values (${reportId}, ${at}, ${stopped}, ${at})
      on conflict (report_id) do update
        set read_at = excluded.read_at, stopped = excluded.stopped, changed_at = excluded.changed_at`,
  );
}
