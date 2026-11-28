import type { FieldStates } from "../../domain/fieldState";
import type { TicketStatus } from "../../domain/stages";
import type { DraftContent } from "../../domain/turn/content";
import { atomically, changedOne, type Database, type Query, row, sql } from "../../platform/database";
import { addMessages, endDraft, type NewMessage } from "./drafts";

// Where a report stands for news: what its newest version holds, how many it has, its photos.
export type FollowUpState = {
  readonly reportId: string;
  readonly status: TicketStatus;
  readonly sentAt: Date;
  readonly versions: number;
  readonly photos: number;
  readonly states: FieldStates;
  readonly hazardType: string;
  readonly villageCode: string;
  // The report's own draft, which its photos belong to.
  readonly draftId: string;
};

type Stored = {
  id: string;
  status: TicketStatus;
  sent_at: string;
  version: number;
  photos: number;
  fields: unknown;
  hazard_type: string;
  village_code: string;
  draft_id: string;
};

// The report is there: its caller read it, and a sent report is never removed.
export async function followUpState(db: Database, ticketNumber: string): Promise<FollowUpState> {
  const found = (await row<Stored>(
    db,
    sql`select r.id, t.status, r.sent_at, v.version, v.fields, r.hazard_type, r.village_code, r.draft_id,
        (select count(*) from draft_photo p where p.draft_id = r.draft_id) as photos
      from report r
      join ticket t on t.report_id = r.id
      join report_version v on v.report_id = r.id
        and v.version = (select max(m.version) from report_version m where m.report_id = r.id)
      where r.ticket_number = ${ticketNumber}`,
  )) as Stored;
  return {
    reportId: found.id,
    status: found.status,
    sentAt: new Date(found.sent_at),
    versions: found.version,
    photos: found.photos,
    states: found.fields as FieldStates | null as FieldStates,
    hazardType: found.hazard_type,
    villageCode: found.village_code,
    draftId: found.draft_id,
  };
}

// A draft of news, opened at its review with one line in its conversation.
export const createFollowUp = (
  draft: {
    readonly id: string;
    readonly reportId: string;
    readonly reporterId: string;
    readonly profileId: string;
    readonly ownerSlot: string;
    readonly villageCode: string;
    readonly hazardType: string;
    readonly content: DraftContent;
    readonly notices: unknown;
    readonly opening: NewMessage;
  },
  at: Date,
): Query[] => [
  sql`insert into report_draft (id, reporter_id, profile_id, owner_slot, state, fields, back_stack, asked, village_code,
      hazard_type, created_at, last_acted_at, pending_notices, follow_up_of)
    values (${draft.id}, ${draft.reporterId}, ${draft.profileId}, ${draft.ownerSlot}, 'summary', ${draft.content},
      '[]', '{}', ${draft.villageCode}, ${draft.hazardType}, ${at}, ${at}, ${draft.notices}, ${draft.reportId})`,
  ...addMessages(draft.id, [draft.opening], at),
];

type News = {
  readonly draftId: string;
  readonly revision: number;
  readonly ticketNumber: string;
  readonly report: FollowUpState;
  readonly states: FieldStates;
  readonly completePercent: number;
  // The report's hazard, known from now on or as it was.
  readonly hazardType: string;
  readonly turnKey: string;
  readonly requestHash: string;
};

// The new version, its history row, its photos and the end of its draft together, or nothing: false
// when the draft, the ticket or the newest version moved after they were read. The ticket's
// revision grows, so a check an officer makes on the older values is refused.
export async function sendFollowUpDraft(db: Database, news: News, at: Date): Promise<boolean> {
  const { report, ticketNumber, draftId } = news;
  const version = report.versions + 1;
  const done = await atomically(db, [
    sql`update report_draft set revision = revision where id = ${draftId} and revision = ${news.revision}
      and state = 'summary'`,
    changedOne,
    sql`update ticket set revision = revision + 1, updated_at = ${at}
      where ticket_number = ${ticketNumber} and status = ${report.status}`,
    changedOne,
    sql`insert into report_version (report_id, version, fields, reporter_name, reporter_number, reporter_role,
        officer_regency, officer_position, privacy_version, consent_agreed_at, complete_percent, created_at)
      select report_id, ${version}, ${news.states}, reporter_name, reporter_number, reporter_role,
        officer_regency, officer_position, privacy_version, consent_agreed_at, ${news.completePercent}, ${at}
      from report_version where report_id = ${report.reportId} and version = ${report.versions}`,
    changedOne,
    sql`update report set hazard_type = ${news.hazardType} where id = ${report.reportId}`,
    sql`insert into ticket_history (ticket_number, from_status, to_status, actor, at, event, detail)
      values (${ticketNumber}, ${report.status}, ${report.status}, 'reporter', ${at}, 'followUp', ${{ version }})`,
    sql`update draft_photo set draft_id = ${report.draftId}, version = ${version} where draft_id = ${draftId}`,
    ...endDraft(draftId, "sent", at),
    sql`insert into turn_reply (draft_id, turn_key, request_hash, status, body, created_at)
      values (${draftId}, ${news.turnKey}, ${news.requestHash}, 201,
        ${JSON.stringify(sentBody(ticketNumber, report.sentAt))}, ${at})`,
  ]);
  return done !== null;
}

// The answer to a send: the report's ticket, and when the report itself was sent.
export const sentBody = (ticketNumber: string, sentAt: Date) => ({
  ticketNumber,
  sentAt: { utc: sentAt.toISOString(), zone: "WIB" as const },
});
