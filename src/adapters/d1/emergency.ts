import type { StaffScope } from "../../domain/deskRights";
import type { EmergencyKind, VictimAnswer } from "../../domain/emergency";
import { ONE_TAP } from "../../domain/emergency";
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
        json_extract(v.fields, '$.place.value.villageName') as village_name,
        json_extract(v.fields, '$.place.value.regencyName') as regency_name
      from report r
      join ticket t on t.report_id = r.id
      join report_version v on v.report_id = r.id and v.version = 1
      where r.emergency is not null and t.status = 'new'${regionCondition(scope)}
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
