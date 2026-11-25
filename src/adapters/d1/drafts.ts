import type { DraftBody } from "../../contract/draft";
import type { DraftState } from "../../domain/draftStates";
import type { ReporterRole } from "../../domain/identityForm";
import { DAY_MS } from "../../domain/time";
import type { AskedCounts, DraftContent } from "../../domain/turn/content";
import type { DraftSnapshot } from "../../domain/turn/engine";
import {
  atomically,
  changedOne,
  type Database,
  parsed,
  type Query,
  row,
  rows,
  run,
  sql,
} from "../../platform/database";

// A draft is kept 24 hours after the reporter last acted on it.
export const DRAFT_LIFE_MS = DAY_MS;

export type DraftRecord = {
  readonly id: string;
  readonly reporterId: string;
  readonly profileId: string | null;
  readonly ownerSlot: string;
  readonly state: DraftState;
  readonly revision: number;
  readonly content: DraftContent | null;
  readonly backStack: readonly DraftSnapshot[];
  readonly asked: AskedCounts;
  readonly offTopicCount: number;
  readonly modelCalls: number;
  readonly templatesOnly: boolean;
  readonly villageCode: string | null;
  readonly hazardType: string | null;
  readonly lastActedAt: Date;
  readonly numberKey: string;
  readonly number: string;
  readonly name: string | null;
  readonly role: ReporterRole | null;
  // Notices of the last turn not yet shown; null when the reporter comes back to the draft.
  readonly pendingNotices: PendingNotices | null;
  // The ticket of the sent report this draft adds news to; null for a report of its own.
  readonly followUpOf: string | null;
};

type PendingNotices = DraftBody["notices"];

type Row = {
  id: string;
  reporter_id: string;
  profile_id: string | null;
  owner_slot: string;
  state: DraftState;
  revision: number;
  fields: string | null;
  back_stack: string | null;
  asked: string;
  off_topic_count: number;
  model_calls: number;
  templates_only: number;
  village_code: string | null;
  hazard_type: string | null;
  last_acted_at: string;
  number_key: string;
  number: string;
  name: string | null;
  role: ReporterRole | null;
  pending_notices: string | null;
  follow_up_of: string | null;
};

const record = (found: Row): DraftRecord => ({
  id: found.id,
  reporterId: found.reporter_id,
  profileId: found.profile_id,
  ownerSlot: found.owner_slot,
  state: found.state,
  revision: found.revision,
  content: parsed<DraftContent>(found.fields),
  backStack: parsed<DraftSnapshot[]>(found.back_stack) ?? [],
  asked: parsed<AskedCounts>(found.asked) as AskedCounts,
  offTopicCount: found.off_topic_count,
  modelCalls: found.model_calls,
  templatesOnly: found.templates_only === 1,
  villageCode: found.village_code,
  hazardType: found.hazard_type,
  lastActedAt: new Date(found.last_acted_at),
  numberKey: found.number_key,
  number: found.number,
  name: found.name,
  role: found.role,
  pendingNotices: parsed<PendingNotices>(found.pending_notices),
  followUpOf: found.follow_up_of,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const OPEN = sql`state not in ('sent', 'cancelled', 'expired')`;

export async function loadDraft(db: Database, draftId: string): Promise<DraftRecord | null> {
  if (!UUID.test(draftId)) return null;
  const found = await row<Row>(
    db,
    sql`
    select d.id, d.reporter_id, d.profile_id, d.owner_slot, d.state, d.revision, d.fields, d.back_stack, d.asked,
      d.off_topic_count, d.model_calls, d.templates_only, d.village_code, d.hazard_type, d.last_acted_at,
      d.pending_notices, r.number_key, r.number, p.name, p.role,
      (select f.ticket_number from report f where f.id = d.follow_up_of) as follow_up_of
    from report_draft d
    join reporter r on r.id = d.reporter_id
    left join reporter_profile p on p.id = d.profile_id
    where d.id = ${draftId}`,
  );
  return found ? record(found) : null;
}

export type OpenDraft = {
  readonly id: string;
  readonly lastActedAt: Date;
  // It adds news to a sent report.
  readonly followUp: boolean;
};

// The open draft of a number in a slot, live or past its 24 hours.
export async function openDraftOf(db: Database, reporterId: string, ownerSlot: string): Promise<OpenDraft | null> {
  const found = await row<{ id: string; last_acted_at: string; follow_up: number }>(
    db,
    sql`select id, last_acted_at, follow_up_of is not null as follow_up from report_draft
      where reporter_id = ${reporterId} and owner_slot = ${ownerSlot} and ${OPEN}`,
  );
  return found ? { id: found.id, lastActedAt: new Date(found.last_acted_at), followUp: found.follow_up === 1 } : null;
}

export const isLive = (draft: Pick<OpenDraft, "lastActedAt">, at: Date) =>
  at.getTime() <= draft.lastActedAt.getTime() + DRAFT_LIFE_MS;

export type TranscriptRow = {
  speaker: "reporter" | "assistant";
  text_masked: string | null;
  copy_key: string | null;
  prompt_key: string | null;
  params: Record<string, string | number> | null;
  card_kind: string | null;
  created_at: Date;
};

type MessageRow = Omit<TranscriptRow, "params" | "created_at"> & { params: string | null; created_at: string };

export async function transcript(db: Database, draftId: string): Promise<TranscriptRow[]> {
  const found = await rows<MessageRow>(
    db,
    sql`select speaker, text_masked, copy_key, prompt_key, params, card_kind, created_at
      from draft_message where draft_id = ${draftId} order by seq`,
  );
  return found.map((line) => ({
    ...line,
    params: parsed<Record<string, string | number>>(line.params),
    created_at: new Date(line.created_at),
  }));
}

export type NewMessage =
  | { readonly speaker: "reporter"; readonly textMasked: string }
  | {
      readonly speaker: "assistant";
      readonly copyKey: string;
      // The question the line asked, when it is not the heading itself.
      readonly promptKey?: string | null;
      readonly params: Readonly<Record<string, string | number>>;
      readonly cardKind: string | null;
    };

// The history lines a write adds, as they read back.
export function transcriptRows(messages: readonly NewMessage[], at: Date): TranscriptRow[] {
  return messages.map((message) =>
    message.speaker === "reporter"
      ? {
          speaker: "reporter",
          text_masked: message.textMasked,
          copy_key: null,
          prompt_key: null,
          params: null,
          card_kind: null,
          created_at: at,
        }
      : {
          speaker: "assistant",
          text_masked: null,
          copy_key: message.copyKey,
          prompt_key: message.promptKey ?? null,
          params: { ...message.params },
          card_kind: message.cardKind,
          created_at: at,
        },
  );
}

// Each line takes the next number of the draft's history, counted inside the batch.
export function addMessages(draftId: string, messages: readonly NewMessage[], at: Date): Query[] {
  const next = sql`(select coalesce(max(seq), 0) + 1 from draft_message where draft_id = ${draftId})`;
  return messages.map((message) =>
    message.speaker === "reporter"
      ? sql`insert into draft_message (draft_id, seq, speaker, text_masked, created_at)
          values (${draftId}, ${next}, 'reporter', ${message.textMasked}, ${at})`
      : sql`insert into draft_message (draft_id, seq, speaker, copy_key, prompt_key, params, card_kind, created_at)
          values (${draftId}, ${next}, 'assistant', ${message.copyKey}, ${message.promptKey ?? null},
            ${message.params}, ${message.cardKind}, ${at})`,
  );
}

// "kembali" undoes a step: the lines that step wrote go with it, so no question is left unanswered.
export const truncateTranscript = (draftId: string, afterSeq: number): Query =>
  sql`delete from draft_message where draft_id = ${draftId} and seq > ${afterSeq}`;

export type StoredReply = { readonly requestHash: string; readonly status: number; readonly body: unknown };

export async function storedReply(db: Database, draftId: string, turnKey: string): Promise<StoredReply | null> {
  const found = await row<{ request_hash: string; status: number; body: string }>(
    db,
    sql`select request_hash, status, body from turn_reply where draft_id = ${draftId} and turn_key = ${turnKey}`,
  );
  return found ? { requestHash: found.request_hash, status: found.status, body: JSON.parse(found.body) } : null;
}

export const storeReply = (draftId: string, turnKey: string, reply: StoredReply, at: Date): Query =>
  sql`insert into turn_reply (draft_id, turn_key, request_hash, status, body, created_at)
    values (${draftId}, ${turnKey}, ${reply.requestHash}, ${reply.status}, ${JSON.stringify(reply.body)}, ${at})`;

export type DraftWrite = {
  readonly state: DraftState;
  readonly content: DraftContent;
  readonly asked: AskedCounts;
  readonly backStack: readonly DraftSnapshot[];
  readonly offTopicCount: number;
  readonly templatesOnly: boolean;
  readonly villageCode: string | null;
  readonly hazardType: string | null;
  readonly pendingNotices: PendingNotices;
};

// Writes a turn, only while the draft is still at the revision the turn was decided on.
export const updateDraft = (draftId: string, revision: number, write: DraftWrite, at: Date): Query =>
  sql`update report_draft set state = ${write.state}, fields = ${write.content},
      asked = ${write.asked}, back_stack = ${write.backStack},
      off_topic_count = ${write.offTopicCount}, templates_only = ${write.templatesOnly},
      village_code = ${write.villageCode}, hazard_type = ${write.hazardType}, pending_notices = ${write.pendingNotices},
      last_acted_at = ${at}, revision = revision + 1
    where id = ${draftId} and revision = ${revision} and ${OPEN}`;

// A photo kept in the photo step: the draft moves on a revision, still in that step.
export const photoAdded = (draftId: string, revision: number, at: Date): Query =>
  sql`update report_draft set last_acted_at = ${at}, revision = revision + 1, pending_notices = null
    where id = ${draftId} and revision = ${revision} and state = 'photos'`;

type EndReason = "sent" | "cancelled" | "expired" | "removedNumber";
const ENDED_STATE: Readonly<Record<EndReason, DraftState>> = {
  sent: "sent",
  cancelled: "cancelled",
  expired: "expired",
  removedNumber: "cancelled",
};

// Ends a draft that is still open and removes its personal content; `when` narrows which state
// of it may be ended. The batch holds only if the draft did end here. A sent draft keeps its
// transcript and photos with the report.
export function endDraft(draftId: string, reason: EndReason, at: Date, when: Query = sql`1 = 1`): Query[] {
  const ended = [
    sql`update report_draft set state = ${ENDED_STATE[reason]}, end_reason = ${reason}, ended_at = ${at},
      fields = null, back_stack = null, pending_notices = null, revision = revision + 1
      where id = ${draftId} and ${OPEN} and ${when}`,
    changedOne,
    sql`delete from turn_reply where draft_id = ${draftId}`,
  ];
  // Photos leave with the draft unless it is sent; the store files follow through photo_removal.
  if (reason !== "sent")
    ended.push(
      sql`delete from draft_message where draft_id = ${draftId}`,
      sql`delete from draft_photo where draft_id = ${draftId}`,
    );
  return ended;
}

// Expires a draft past its 24 hours, only if the reporter has not acted since it was read: a tap that lands first wins.
export async function expireDraft(db: Database, draft: Pick<OpenDraft, "id" | "lastActedAt">, at: Date): Promise<void> {
  await atomically(db, endDraft(draft.id, "expired", at, sql`last_acted_at = ${draft.lastActedAt}`));
}

// Opening a draft is acting on it; the notices waiting for this read are shown now and cleared.
export async function touchDraft(db: Database, draftId: string, at: Date): Promise<void> {
  await run(
    db,
    sql`update report_draft set last_acted_at = ${at}, pending_notices = null where id = ${draftId} and ${OPEN}`,
  );
}
