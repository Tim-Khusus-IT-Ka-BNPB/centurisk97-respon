import type { NoticeRow } from "../../domain/chat/news";
import { SESSION_SLOT } from "../../domain/ownership";
import type { TicketStatus } from "../../domain/stages";
import { type Database, empty, type Query, row, rows, run, sql } from "../../platform/database";

export type NewsChoice = "asked" | "yes" | "no";

// What a number last said of news in its chat; null when it was never asked.
export async function newsChoice(db: Database, numberKey: string): Promise<NewsChoice | null> {
  const found = await row<{ choice: NewsChoice }>(
    db,
    sql`select choice from news_choice where number_key = ${numberKey} order by id desc limit 1`,
  );
  return found?.choice ?? null;
}

export async function addNewsChoice(db: Database, numberKey: string, choice: NewsChoice, at: Date): Promise<void> {
  await run(db, sql`insert into news_choice (number_key, choice, at) values (${numberKey}, ${choice}, ${at})`);
}

// What waits for a gateway: notices of a report of a proved number still allowed, written after it said
// yes, or a document it asked for; not stopped, not sent yet, and not older than `since`.
const WAITING = (since: Date): Query => sql`
  from notice n
  join report r on r.ticket_number = n.ticket_number
  join reporter who on who.id = r.reporter_id
  left join report_news w on w.report_id = r.id
  left join news_choice c on c.id = (select max(m.id) from news_choice m where m.number_key = r.number_key)
  where n.at >= ${since} and r.owner_slot = ${SESSION_SLOT} and not r.number_unverified and not coalesce(w.stopped, false)
    and exists (select 1 from pilot_number a where a.number_key = r.number_key)
    and not exists (select 1 from notice_delivery d where d.notice_id = n.id)
    and ((n.kind = 'document' and n.at >= coalesce(c.at, '-infinity')) or (c.choice = 'yes' and n.at >= c.at))`;

// The act one notice is of: every notice of its ticket written at the same moment.
const SAME_ACT = (noticeId: number): Query =>
  sql` and (n.ticket_number, n.at) = (select s.ticket_number, s.at from notice s where s.id = ${noticeId})`;

export type WaitingNotice = NoticeRow & {
  readonly number: string;
  readonly villageCode: string;
  readonly hazardType: string;
  readonly reportId: string;
};

type Stored = {
  id: number;
  ticket_number: string;
  at: string;
  kind: NoticeRow["kind"];
  version: number | null;
  corrected: number | null;
  to_status: TicketStatus | null;
  note: string | null;
  detail: { actions?: string[] } | null;
  reply: string | null;
  number: string;
  village_code: string;
  hazard_type: string;
  report_id: string;
};

const DETAILS = sql`select n.id, n.ticket_number, n.at, n.kind, n.version, who.number, r.village_code, r.hazard_type,
    r.id as report_id,
    (select f.version from field_check f where f.ticket_number = n.ticket_number and f.at = n.at) as corrected,
    (select h.to_status from ticket_history h where h.id = n.history_id) as to_status,
    (select h.note from ticket_history h where h.id = n.history_id) as note,
    (select h.detail from ticket_history h where h.id = n.history_id) as detail,
    (select p.text from report_reply p where p.id = n.reply_id) as reply`;

// What waits, oldest first; of one act alone when a notice of it is named.
export async function waitingNotices(
  db: Database,
  since: Date,
  limit: number,
  noticeId: number | null = null,
): Promise<WaitingNotice[]> {
  const found = await rows<Stored>(
    db,
    sql`${DETAILS}${WAITING(since)}${noticeId === null ? empty : SAME_ACT(noticeId)} order by n.id limit ${limit}`,
  );
  return found.map((one) => ({
    id: one.id,
    ticketNumber: one.ticket_number,
    atMs: Date.parse(one.at),
    kind: one.kind,
    status: one.to_status,
    note: one.note,
    actions: (one.detail as { actions?: string[] } | null)?.actions ?? [],
    reply: one.reply,
    version: one.kind === "correction" ? one.corrected : one.version,
    number: one.number,
    villageCode: one.village_code,
    hazardType: one.hazard_type,
    reportId: one.report_id,
  }));
}

// A gateway sent the act a notice is of; false when nothing of it was waiting.
export async function markDelivered(
  db: Database,
  noticeId: number,
  gatewayId: string,
  since: Date,
  at: Date,
): Promise<boolean> {
  const marked = await run(
    db,
    sql`insert into notice_delivery (notice_id, gateway_id, at)
      select n.id, ${gatewayId}, ${at}${WAITING(since)}${SAME_ACT(noticeId)}`,
  );
  return marked > 0;
}

// A document to send in the chat, unless the same one is waiting.
export async function askForDocument(
  db: Database,
  ticketNumber: string,
  version: number,
  since: Date,
  at: Date,
): Promise<void> {
  await run(
    db,
    sql`insert into notice (ticket_number, kind, version, at)
      select ${ticketNumber}, 'document', ${version}, ${at}
      where not exists (select 1${WAITING(since)} and n.ticket_number = ${ticketNumber} and n.kind = 'document'
        and n.version = ${version})`,
  );
}

export type ReportDelivery = {
  // The number wants news in its chat.
  readonly wanted: boolean;
  readonly waiting: number;
  readonly lastSentAt: Date | null;
  readonly replies: readonly { readonly sentAt: Date | null; readonly waiting: boolean }[];
};

// What of a report reaches its reporter's chat; null for a report whose number has none.
export async function reportDelivery(db: Database, ticketNumber: string, since: Date): Promise<ReportDelivery | null> {
  const found = await row<{ choice: NewsChoice | null }>(
    db,
    sql`select (select m.choice from news_choice m where m.number_key = r.number_key order by m.id desc limit 1) as choice
      from report r where r.ticket_number = ${ticketNumber} and r.door = 'chat'`,
  );
  if (found === null) return null;
  const waiting = new Set(
    (await rows<{ id: number }>(db, sql`select n.id${WAITING(since)} and n.ticket_number = ${ticketNumber}`)).map(
      (one) => one.id,
    ),
  );
  const sent = await rows<{ id: number; sent_at: string }>(
    db,
    sql`select d.notice_id as id, d.at as sent_at from notice_delivery d join notice n on n.id = d.notice_id
      where n.ticket_number = ${ticketNumber} order by d.at`,
  );
  const replies = await rows<{ notice_id: number | null }>(
    db,
    sql`select (select n.id from notice n where n.reply_id = p.id) as notice_id from report_reply p
      where p.ticket_number = ${ticketNumber} order by p.at, p.id`,
  );
  const sentAt = new Map(sent.map((one) => [one.id, new Date(one.sent_at)]));
  return {
    wanted: found.choice === "yes",
    waiting: waiting.size,
    lastSentAt: sent.length === 0 ? null : (sentAt.get((sent.at(-1) as { id: number }).id) as Date),
    replies: replies.map(({ notice_id: id }) => ({
      sentAt: id === null ? null : (sentAt.get(id) ?? null),
      waiting: id !== null && waiting.has(id),
    })),
  };
}
