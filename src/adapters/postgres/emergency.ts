import type { StaffScope } from "../../domain/deskRights";
import type { EmergencyKind, VictimAnswer } from "../../domain/emergency";
import { ONE_TAP } from "../../domain/emergency";
import type { OfflineMark } from "../../domain/offline";
import { DAY_MS } from "../../domain/time";
import { atomically, type Database, holds, row, rows, sql } from "../../platform/database";
import { regionCondition } from "./deskShared";
import { insertReport, type NewReport, nextSequence } from "./send";

// When this number on this phone last raised an alarm by one tap.
export async function lastOneTap(db: Database, numberKey: string, ownerSlot: string): Promise<number | null> {
  const found = (await row<{ at: string | null }>(
    db,
    sql`select max(sent_at) as at from report
      where number_key = ${numberKey} and owner_slot = ${ownerSlot} and emergency = 'oneTap'`,
  )) as { at: string | null };
  return found.at === null ? null : Date.parse(found.at);
}

// When this number did in the last day, on any phone, oldest first.
export async function oneTapsOfDay(db: Database, numberKey: string, nowMs: number): Promise<number[]> {
  const found = await rows<{ sent_at: string }>(
    db,
    sql`select sent_at from report where number_key = ${numberKey} and emergency = 'oneTap'
      and sent_at > ${new Date(nowMs - DAY_MS)} order by sent_at`,
  );
  return found.map((one) => Date.parse(one.sent_at));
}

// The report, with a draft row that is already ended: one tap has no conversation to keep. Null
// when another tap of this number on this phone got in first.
export async function sendOneTap(
  db: Database,
  report: NewReport,
  profileId: string,
  wibDate: string,
  // Its id from the phone, so a send repeated gives the same ticket; with what the desk is told of a
  // report kept there with no signal.
  offline: { readonly clientId: string; readonly mark: OfflineMark | null } | null = null,
): Promise<string | null> {
  const since = new Date(report.sentAt.getTime() - ONE_TAP.deviceEveryMs);
  const done = await atomically(db, [
    holds(sql`not exists (select 1 from report where number_key = ${report.numberKey}
      and owner_slot = ${report.ownerSlot} and emergency = 'oneTap' and sent_at > ${since})`),
    sql`insert into report_draft (id, reporter_id, profile_id, owner_slot, state, village_code, created_at,
        last_acted_at, ended_at, end_reason)
      values (${report.draftId}, ${report.reporterId}, ${profileId}, ${report.ownerSlot}, 'sent',
        ${report.villageCode}, ${report.sentAt}, ${report.sentAt}, ${report.sentAt}, 'sent')`,
    nextSequence(wibDate),
    ...insertReport(report),
    ...(offline === null
      ? []
      : [
          sql`insert into offline_send (client_id, ticket_number, at, kept, saved_at, late)
            select ${offline.clientId}, ticket_number, ${report.sentAt}, ${offline.mark !== null},
              ${offline.mark?.savedAt == null ? null : new Date(offline.mark.savedAt)}, ${offline.mark?.late ?? false}
            from report where id = ${report.reportId}`,
        ]),
  ]);
  if (done === null) return null;
  const [sent] = done[3] as { ticket_number: string }[];
  return (sent as { ticket_number: string }).ticket_number;
}

export type OpenEmergency = {
  readonly ticketNumber: string;
  readonly kind: EmergencyKind;
  readonly victims: VictimAnswer;
  readonly hazardType: string;
  readonly villageCode: string;
  readonly villageName: string;
  readonly regencyName: string;
  readonly sentAt: Date;
};

// Emergencies nobody has opened yet, newest first.
export async function openEmergencies(db: Database, scope: StaffScope, limit: number): Promise<OpenEmergency[]> {
  const found = await rows<{
    ticket_number: string;
    emergency: EmergencyKind;
    emergency_victims: VictimAnswer;
    hazard_type: string;
    village_code: string;
    village_name: string;
    regency_name: string;
    sent_at: string;
  }>(
    db,
    sql`select r.ticket_number, r.emergency, r.emergency_victims, r.hazard_type, r.village_code, r.sent_at,
        (v.fields #>> '{place,value,villageName}') as village_name,
        (v.fields #>> '{place,value,regencyName}') as regency_name
      from report r
      join ticket t on t.report_id = r.id
      join report_version v on v.report_id = r.id and v.version = 1
      where r.emergency is not null and t.status = 'new'${regionCondition(scope)}
        and not exists (select 1 from offline_send o where o.ticket_number = r.ticket_number and o.late)
      order by r.sent_at desc, r.ticket_number desc limit ${limit}`,
  );
  return found.map((one) => ({
    ticketNumber: one.ticket_number,
    kind: one.emergency,
    victims: one.emergency_victims,
    hazardType: one.hazard_type,
    villageCode: one.village_code,
    villageName: one.village_name,
    regencyName: one.regency_name,
    sentAt: new Date(one.sent_at),
  }));
}

// A report sent before under this id made on the phone, with the draft its photos go under, whose
// phone it is, and when that phone saved it; or null.
export type OfflineTicket = {
  readonly ticketNumber: string;
  readonly reportId: string;
  readonly villageCode: string;
  readonly draftId: string;
  readonly ownerSlot: string;
  readonly savedAt: number | null;
};

export const offlineTicket = async (db: Database, clientId: string): Promise<OfflineTicket | null> => {
  const found = await row<{
    ticket_number: string;
    report_id: string;
    village_code: string;
    draft_id: string;
    owner_slot: string;
    saved_at: string | null;
  }>(
    db,
    sql`select o.ticket_number, o.saved_at, r.id as report_id, r.village_code, r.draft_id, d.owner_slot
      from offline_send o join report r on r.ticket_number = o.ticket_number
        join report_draft d on d.id = r.draft_id
      where o.client_id = ${clientId}`,
  );
  return found === null
    ? null
    : {
        ticketNumber: found.ticket_number,
        reportId: found.report_id,
        villageCode: found.village_code,
        draftId: found.draft_id,
        ownerSlot: found.owner_slot,
        savedAt: found.saved_at === null ? null : Date.parse(found.saved_at),
      };
};
