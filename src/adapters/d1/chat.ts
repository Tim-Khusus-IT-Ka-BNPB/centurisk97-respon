import type { ChatStep } from "../../domain/chat/step";
import type { SharedPoint } from "../../domain/photoChecks";
import { type Database, parsed, row, run, sql } from "../../platform/database";

export type ChatSession = {
  readonly step: ChatStep | null;
  // The location last shared in the chat.
  readonly shared: SharedPoint | null;
};

const NONE: ChatSession = { step: null, shared: null };

// Where a chat stands, unless it has been quiet since before then.
export async function chatSession(db: Database, numberKey: string, since: Date): Promise<ChatSession> {
  const found = await row<{ step: string | null; shared_point: string | null }>(
    db,
    sql`select step, shared_point from chat_session where number_key = ${numberKey} and updated_at > ${since}`,
  );
  return found === null
    ? NONE
    : { step: parsed<ChatStep>(found.step), shared: parsed<SharedPoint>(found.shared_point) };
}

export async function saveChatSession(db: Database, numberKey: string, session: ChatSession, at: Date): Promise<void> {
  await run(
    db,
    sql`insert into chat_session (number_key, step, shared_point, updated_at)
      values (${numberKey}, ${session.step}, ${session.shared}, ${at})
      on conflict (number_key) do update set step = excluded.step, shared_point = excluded.shared_point,
        updated_at = excluded.updated_at`,
  );
}

export async function forgetChat(db: Database, numberKey: string): Promise<void> {
  await run(db, sql`delete from chat_session where number_key = ${numberKey}`);
}
