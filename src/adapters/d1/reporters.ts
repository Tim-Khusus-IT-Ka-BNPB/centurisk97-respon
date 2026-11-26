import type { DraftState } from "../../domain/draftStates";
import type { Identity, ReporterRole } from "../../domain/identityForm";
import type { DraftContent } from "../../domain/turn/content";
import { type Database, type Query, row, rows, sql } from "../../platform/database";

export type ProfileRow = {
  id: string;
  reporter_id: string;
  owner_slot: string;
  device_id: string | null;
  name: string;
  role: ReporterRole;
  officer_regency: string | null;
  officer_position: string | null;
  last_used_at: Date;
  number: string;
  number_key: string;
};

type StoredProfile = Omit<ProfileRow, "last_used_at"> & { last_used_at: string };

const profile = (found: StoredProfile): ProfileRow => ({ ...found, last_used_at: new Date(found.last_used_at) });

const PROFILE_COLUMNS = sql`
  p.id, p.reporter_id, p.owner_slot, p.device_id, p.name, p.role, p.officer_regency, p.officer_position,
  p.last_used_at, r.number, r.number_key`;

export const createDevice = (deviceId: string, fingerprint: string, at: Date): Query =>
  sql`insert into device (id, key_fingerprint, created_at, last_seen_at) values (${deviceId}, ${fingerprint}, ${at}, ${at})`;

// The number's row, written or kept; the id is the stored one when the number is already known.
export const upsertReporter = (reporterId: string, number: string, numberKey: string, at: Date): Query =>
  sql`insert into reporter (id, number, number_key, created_at) values (${reporterId}, ${number}, ${numberKey}, ${at})
    on conflict (number_key) do update set number = excluded.number`;

export async function reporterIdOf(db: Database, numberKey: string): Promise<string | null> {
  const found = await row<{ id: string }>(db, sql`select id from reporter where number_key = ${numberKey}`);
  return found?.id ?? null;
}

export const profileCount = (deviceId: string): Query =>
  sql`(select count(*) from reporter_profile where device_id = ${deviceId})`;

export async function profileBySlot(db: Database, reporterId: string, ownerSlot: string): Promise<ProfileRow | null> {
  const found = await row<StoredProfile>(
    db,
    sql`select ${PROFILE_COLUMNS} from reporter_profile p join reporter r on r.id = p.reporter_id
      where p.reporter_id = ${reporterId} and p.owner_slot = ${ownerSlot}`,
  );
  return found ? profile(found) : null;
}

export async function profileById(db: Database, profileId: string): Promise<ProfileRow | null> {
  const found = await row<StoredProfile>(
    db,
    sql`select ${PROFILE_COLUMNS} from reporter_profile p join reporter r on r.id = p.reporter_id
      where p.id = ${profileId}`,
  );
  return found ? profile(found) : null;
}

// Writes who reports from this slot. A second device typing the same number gets its own row,
// so it never sees or changes the first device's name. The number's row is found by its key, so
// a number written in the same batch is found too.
export const saveProfile = (
  profileId: string,
  numberKey: string,
  ownerSlot: string,
  deviceId: string | null,
  identity: Identity,
  at: Date,
): Query =>
  sql`insert into reporter_profile (id, reporter_id, owner_slot, device_id, name, role, officer_regency, officer_position,
      created_at, last_used_at)
    values (${profileId}, (select id from reporter where number_key = ${numberKey}), ${ownerSlot}, ${deviceId},
      ${identity.name}, ${identity.role}, ${identity.officerRegency}, ${identity.officerPosition}, ${at}, ${at})
    on conflict (reporter_id, owner_slot) do update set name = excluded.name, role = excluded.role,
      officer_regency = excluded.officer_regency, officer_position = excluded.officer_position,
      last_used_at = excluded.last_used_at`;

// The profile of a number in a slot, by key: the id a write in the same batch gave it.
export const profileOf = (numberKey: string, ownerSlot: string): Query =>
  sql`(select p.id from reporter_profile p join reporter r on r.id = p.reporter_id
    where r.number_key = ${numberKey} and p.owner_slot = ${ownerSlot})`;

export const updateProfile = (profileId: string, identity: Omit<Identity, "number"> | null, at: Date): Query =>
  identity === null
    ? sql`update reporter_profile set last_used_at = ${at} where id = ${profileId}`
    : sql`update reporter_profile set name = ${identity.name}, role = ${identity.role},
        officer_regency = ${identity.officerRegency}, officer_position = ${identity.officerPosition}, last_used_at = ${at}
        where id = ${profileId}`;

export const addConsent = (consentId: string, profileIdOf: Query, privacyVersion: number, at: Date): Query =>
  sql`insert into reporter_consent (id, profile_id, privacy_version, agreed_at)
    values (${consentId}, ${profileIdOf}, ${privacyVersion}, ${at})`;

export async function latestConsent(
  db: Database,
  profileId: string,
): Promise<{ privacyVersion: number; agreedAt: Date } | null> {
  // Every profile is written with its consent; none means the profile was just removed.
  const found = await row<{ privacy_version: number; agreed_at: string }>(
    db,
    sql`select privacy_version, agreed_at from reporter_consent where profile_id = ${profileId}
      order by agreed_at desc limit 1`,
  );
  return found === null ? null : { privacyVersion: found.privacy_version, agreedAt: new Date(found.agreed_at) };
}

export const createDraft = (
  draftId: string,
  numberKey: string,
  profileIdOf: Query,
  ownerSlot: string,
  at: Date,
  firstNotices: unknown,
  content: DraftContent,
  // A place known from the start (a poster's village) moves the draft past the place question.
  start: { readonly state: DraftState; readonly villageCode: string | null } = { state: "place", villageCode: null },
): Query =>
  sql`insert into report_draft (id, reporter_id, profile_id, owner_slot, state, fields, back_stack, asked, created_at,
      last_acted_at, pending_notices, village_code)
    values (${draftId}, (select id from reporter where number_key = ${numberKey}), ${profileIdOf}, ${ownerSlot},
      ${start.state}, ${content}, '[]', '{}', ${at}, ${at}, ${firstNotices}, ${start.villageCode})`;

// An open draft turned into an emergency, its answers kept.
export const makeEmergency = (draftId: string): Query =>
  sql`update report_draft set fields = json_set(fields, '$.emergency', json('{"victims":null}')), revision = revision + 1
    where id = ${draftId} and fields is not null and json_extract(fields, '$.emergency') is null`;

export type KnownRow = ProfileRow & {
  draft_id: string | null;
  draft_hazard_type: string | null;
  draft_village_code: string | null;
  draft_last_acted_at: Date | null;
  // The ticket its open draft adds news to.
  draft_follow_up_of: string | null;
};

// The numbers this device or session knows, latest first, each with its open draft if one is still live.
export async function knownProfiles(
  db: Database,
  where: { deviceId: string } | { reporterId: string },
  liveSince: Date,
): Promise<KnownRow[]> {
  const filter =
    "deviceId" in where
      ? sql`p.device_id = ${where.deviceId}`
      : sql`p.reporter_id = ${where.reporterId} and p.owner_slot = 'session'`;
  const found = await rows<
    StoredProfile & Omit<KnownRow, keyof ProfileRow | "draft_last_acted_at"> & { draft_last_acted_at: string | null }
  >(
    db,
    sql`
    select ${PROFILE_COLUMNS}, d.id as draft_id, d.hazard_type as draft_hazard_type,
      d.village_code as draft_village_code, d.last_acted_at as draft_last_acted_at,
      (select f.ticket_number from report f where f.id = d.follow_up_of) as draft_follow_up_of
    from reporter_profile p
    join reporter r on r.id = p.reporter_id
    left join report_draft d on d.reporter_id = p.reporter_id and d.owner_slot = p.owner_slot
      and d.state not in ('sent', 'cancelled', 'expired') and d.last_acted_at > ${liveSince}
    where ${filter}
    order by p.last_used_at desc, p.id`,
  );
  return found.map((known) => ({
    ...profile(known),
    draft_id: known.draft_id,
    draft_hazard_type: known.draft_hazard_type,
    draft_village_code: known.draft_village_code,
    draft_follow_up_of: known.draft_follow_up_of,
    draft_last_acted_at: known.draft_last_acted_at === null ? null : new Date(known.draft_last_acted_at),
  }));
}

export const deleteProfile = (profileId: string): Query => sql`delete from reporter_profile where id = ${profileId}`;

// A number row goes when nothing uses it: no profile, no seeded session, no draft tied to a sent report.
export const deleteUnusedReporters = (reporterIds: Query): Query =>
  sql`delete from reporter where id in ${reporterIds}
    and not exists (select 1 from reporter_profile where reporter_id = reporter.id)
    and not exists (select 1 from seeded_session where reporter_id = reporter.id)
    and not exists (select 1 from report_draft d join report t on t.draft_id = d.id where d.reporter_id = reporter.id)`;
