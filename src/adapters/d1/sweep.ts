import type { SweepCutoffs } from "../../domain/retention";
import { atomically, type Database, type Query, sql } from "../../platform/database";

// Every step is one batch of at most `batch` rows, picked inside the statement that changes them,
// so a step only ever touches rows that are still due when it runs.

const counted = async (db: Database, queries: Query[]): Promise<number> => {
  const results = (await atomically(db, queries)) as unknown[][];
  return Math.max(...results.map((result) => result.length));
};

// Expires open drafts last acted on before the cutoff and removes their content, notices,
// transcript, stored replies and photos. A tap that lands first moves last_acted_at past the cutoff, so
// the draft is no longer due.
export async function expireBatch(db: Database, cutoffs: SweepCutoffs, now: Date, batch: number): Promise<number> {
  const ended = sql`select id from report_draft where state = 'expired' and end_reason = 'expired' and ended_at = ${now}`;
  return counted(db, [
    sql`update report_draft set state = 'expired', end_reason = 'expired', ended_at = ${now},
        fields = null, back_stack = null, pending_notices = null, revision = revision + 1
      where id in (
        select id from report_draft
        where state not in ('sent', 'cancelled', 'expired') and last_acted_at < ${cutoffs.draftActedBefore}
        order by last_acted_at limit ${batch})
      returning id`,
    sql`delete from draft_message where draft_id in (${ended})`,
    sql`delete from turn_reply where draft_id in (${ended})`,
    sql`delete from draft_photo where draft_id in (${ended})`,
  ]);
}

export async function pruneBatch(db: Database, cutoffs: SweepCutoffs, batch: number): Promise<number> {
  return counted(db, [
    sql`delete from turn_reply where rowid in (
        select rowid from turn_reply where created_at < ${cutoffs.turnReplyBefore} limit ${batch})
      returning 1`,
    sql`delete from rate_counter where rowid in (
        select rowid from rate_counter where window_start < ${cutoffs.rateWindowBefore} limit ${batch})
      returning 1`,
    sql`delete from model_usage where rowid in (
        select rowid from model_usage where wib_date < ${cutoffs.modelUsageBefore} limit ${batch})
      returning 1`,
    sql`delete from gateway_message where rowid in (
        select rowid from gateway_message where received_at < ${cutoffs.gatewayMessageBefore} limit ${batch})
      returning 1`,
    sql`delete from chat_session where rowid in (
        select rowid from chat_session where updated_at < ${cutoffs.chatSessionBefore} limit ${batch})
      returning 1`,
  ]);
}

// Removes devices unseen for a year, their profiles and consents with them, then the numbers
// nothing uses any more: no profile, no seeded session, no draft tied to a sent report.
export async function removeDeviceBatch(db: Database, cutoffs: SweepCutoffs, batch: number): Promise<number> {
  return counted(db, [
    sql`delete from device where id in (
        select id from device where last_seen_at < ${cutoffs.deviceSeenBefore} order by last_seen_at limit ${batch})
      returning id`,
    sql`delete from reporter
      where not exists (select 1 from reporter_profile p where p.reporter_id = reporter.id)
        and not exists (select 1 from seeded_session s where s.reporter_id = reporter.id)
        and not exists (select 1 from report_draft d join report t on t.draft_id = d.id where d.reporter_id = reporter.id)`,
  ]);
}

// Removes the empty rows of drafts cancelled or expired 30 days ago. Sent drafts stay with their report.
export async function removeEmptiedBatch(db: Database, cutoffs: SweepCutoffs, batch: number): Promise<number> {
  return counted(db, [
    sql`delete from report_draft where id in (
        select id from report_draft
        where state in ('cancelled', 'expired') and ended_at < ${cutoffs.draftEndedBefore} limit ${batch})
      returning id`,
  ]);
}
