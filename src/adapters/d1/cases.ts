import type { CaseKind } from "../../domain/caseSpec";
import { atomically, changedOne, type Database, holds, type Query, row, rows, sql } from "../../platform/database";
import { historyNotice, IF_WRITTEN } from "./news";

// The BPBD's follow-up files (M09) as kept: files, their team, records, media, trail and access log.

export type CaseFileRow = {
  readonly id: string;
  readonly ticketNumber: string;
  readonly regencyCode: string;
  readonly status: "open" | "proposed" | "done" | "doneNoted";
  readonly fields: Readonly<Record<string, unknown>>;
  readonly nil: readonly string[];
  readonly revision: number;
  readonly openedBy: string;
  readonly openedAtMs: number;
  readonly acceptedAtMs: number | null;
};

type StoredFile = {
  id: string;
  ticket_number: string;
  regency_code: string;
  status: CaseFileRow["status"];
  fields: string;
  nil: string;
  revision: number;
  opened_by: string;
  opened_at: string;
  accepted_at: string | null;
};

const FILE = sql`select id, ticket_number, regency_code, status, fields, nil, revision, opened_by, opened_at, accepted_at
  from case_file`;

const fileOf = (stored: StoredFile): CaseFileRow => ({
  id: stored.id,
  ticketNumber: stored.ticket_number,
  regencyCode: stored.regency_code,
  status: stored.status,
  fields: JSON.parse(stored.fields),
  nil: JSON.parse(stored.nil),
  revision: stored.revision,
  openedBy: stored.opened_by,
  openedAtMs: Date.parse(stored.opened_at),
  acceptedAtMs: stored.accepted_at === null ? null : Date.parse(stored.accepted_at),
});

export async function caseById(db: Database, id: string): Promise<CaseFileRow | null> {
  const found = await row<StoredFile>(db, sql`${FILE} where id = ${id}`);
  return found === null ? null : fileOf(found);
}

export async function caseOfTicket(db: Database, ticketNumber: string): Promise<CaseFileRow | null> {
  const found = await row<StoredFile>(db, sql`${FILE} where ticket_number = ${ticketNumber}`);
  return found === null ? null : fileOf(found);
}

// The files of a region, newest first: a regency's, a province's, or all.
export async function casesIn(db: Database, codePrefix: string | null): Promise<CaseFileRow[]> {
  const found = await rows<StoredFile>(
    db,
    sql`${FILE} where ${codePrefix} is null or regency_code like ${`${codePrefix}%`} order by opened_at desc limit 200`,
  );
  return found.map(fileOf);
}

const trailRow = (
  fileId: string,
  recordId: string | null,
  action: string,
  detail: unknown,
  byLabel: string,
  at: Date,
): Query =>
  sql`insert into case_trail (file_id, record_id, action, detail, by_label, at)
    values (${fileId}, ${recordId}, ${action}, ${detail}, ${byLabel}, ${at})`;

// A file opened for a report, once: a second opening finds the first.
export async function openCase(
  db: Database,
  file: { readonly id: string; readonly ticketNumber: string; readonly regencyCode: string; readonly by: string },
  at: Date,
): Promise<void> {
  await atomically(db, [
    sql`insert into case_file (id, ticket_number, regency_code, opened_by, opened_at)
      values (${file.id}, ${file.ticketNumber}, ${file.regencyCode}, ${file.by}, ${at})
      on conflict (ticket_number) do nothing`,
    sql`insert into case_trail (file_id, action, by_label, at)
      select ${file.id}, 'open', ${file.by}, ${at} where changes() = 1`,
  ]);
}

export type CaseRecordRow = {
  readonly id: string;
  readonly kind: CaseKind;
  readonly seq: number;
  readonly data: Readonly<Record<string, unknown>>;
  readonly personal: Readonly<Record<string, unknown>>;
  readonly point: { readonly lat: number; readonly lon: number } | null;
  readonly cancelledReason: string | null;
  readonly revision: number;
  readonly byLabel: string;
  readonly updatedAtMs: number;
  readonly media: readonly {
    readonly id: string;
    readonly kind: "photo" | "face" | "video";
    readonly point: { readonly lat: number; readonly lon: number } | null;
    readonly badge: "gps" | "exif" | "none";
    readonly takenAtMs: number | null;
  }[];
};

const pointOf = (lat: number | null, lon: number | null) => (lat === null || lon === null ? null : { lat, lon });

// A file's records in order of kind and number, each with its media still kept.
export async function recordsOf(db: Database, fileId: string): Promise<CaseRecordRow[]> {
  const [records, media] = await Promise.all([
    rows<{
      id: string;
      kind: CaseKind;
      seq: number;
      data: string;
      personal: string;
      lat: number | null;
      lon: number | null;
      cancelled_reason: string | null;
      revision: number;
      by_label: string;
      updated_at: string;
    }>(
      db,
      sql`select id, kind, seq, data, personal, lat, lon, cancelled_reason, revision, by_label, updated_at
        from case_record where file_id = ${fileId} order by kind, seq`,
    ),
    rows<{
      id: string;
      record_id: string;
      kind: "photo" | "face" | "video";
      lat: number | null;
      lon: number | null;
      badge: "gps" | "exif" | "none";
      taken_at: string | null;
    }>(
      db,
      sql`select id, record_id, kind, lat, lon, badge, taken_at from case_media
        where file_id = ${fileId} and erased_at is null order by at, id`,
    ),
  ]);
  return records.map((one) => ({
    id: one.id,
    kind: one.kind,
    seq: one.seq,
    data: JSON.parse(one.data),
    personal: JSON.parse(one.personal),
    point: pointOf(one.lat, one.lon),
    cancelledReason: one.cancelled_reason,
    revision: one.revision,
    byLabel: one.by_label,
    updatedAtMs: Date.parse(one.updated_at),
    media: media
      .filter((item) => item.record_id === one.id)
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        point: pointOf(item.lat, item.lon),
        badge: item.badge,
        takenAtMs: item.taken_at === null ? null : Date.parse(item.taken_at),
      })),
  }));
}

const OPEN = (fileId: string): Query => holds(sql`(select status from case_file where id = ${fileId}) = 'open'`);

export type RecordWrite = {
  readonly fileId: string;
  readonly kind: CaseKind;
  readonly data: Readonly<Record<string, unknown>>;
  readonly personal: Readonly<Record<string, unknown>>;
  readonly point: { readonly lat: number; readonly lon: number } | null;
  readonly by: string;
  // The trail's detail: general values in full, personal ones by fingerprint.
  readonly trail: unknown;
  // The file's nil marks after this record: a metric it fills is no longer nil.
  readonly nil: readonly string[];
};

// A new record, numbered within its kind, while the file is open. Sent again with its client id,
// it answers the record it made the first time.
export async function addRecord(
  db: Database,
  write: RecordWrite & { readonly id: string; readonly clientId: string | null },
  at: Date,
): Promise<string | null> {
  if (write.clientId !== null) {
    const earlier = await row<{ id: string }>(
      db,
      sql`select id from case_record where file_id = ${write.fileId} and client_id = ${write.clientId}`,
    );
    if (earlier !== null) return earlier.id;
  }
  const done = await atomically(db, [
    OPEN(write.fileId),
    sql`insert into case_record (id, file_id, kind, seq, data, personal, lat, lon, client_id, by_label, created_at,
        updated_at)
      values (${write.id}, ${write.fileId}, ${write.kind},
        (select coalesce(max(seq), 0) + 1 from case_record where file_id = ${write.fileId} and kind = ${write.kind}),
        ${write.data}, ${write.personal}, ${write.point?.lat ?? null}, ${write.point?.lon ?? null}, ${write.clientId},
        ${write.by}, ${at}, ${at})`,
    sql`update case_file set nil = ${JSON.stringify(write.nil)}, revision = revision + 1 where id = ${write.fileId}`,
    trailRow(write.fileId, write.id, "add", write.trail, write.by, at),
  ]);
  return done === null ? null : write.id;
}

// A record's values changed, from the revision the writer read, while the file is open.
export async function changeRecord(
  db: Database,
  write: RecordWrite & { readonly id: string; readonly revision: number },
  at: Date,
): Promise<boolean> {
  const done = await atomically(db, [
    OPEN(write.fileId),
    sql`update case_record set data = ${write.data}, personal = ${write.personal}, lat = ${write.point?.lat ?? null},
        lon = ${write.point?.lon ?? null}, revision = revision + 1, by_label = ${write.by}, updated_at = ${at}
      where id = ${write.id} and file_id = ${write.fileId} and revision = ${write.revision}
        and cancelled_reason is null`,
    changedOne,
    sql`update case_file set nil = ${JSON.stringify(write.nil)}, revision = revision + 1 where id = ${write.fileId}`,
    trailRow(write.fileId, write.id, "change", write.trail, write.by, at),
  ]);
  return done !== null;
}

// A record entered by mistake: set aside with its reason, never deleted (D4).
export async function cancelRecord(
  db: Database,
  cancel: { readonly fileId: string; readonly id: string; readonly reason: string; readonly by: string },
  at: Date,
): Promise<boolean> {
  const done = await atomically(db, [
    OPEN(cancel.fileId),
    sql`update case_record set cancelled_reason = ${cancel.reason}, revision = revision + 1, updated_at = ${at}
      where id = ${cancel.id} and file_id = ${cancel.fileId} and cancelled_reason is null`,
    changedOne,
    trailRow(cancel.fileId, cancel.id, "cancel", { reason: cancel.reason }, cancel.by, at),
  ]);
  return done !== null;
}

export type NewMedia = {
  readonly id: string;
  readonly fileId: string;
  readonly recordId: string;
  readonly kind: "photo" | "face" | "video";
  readonly objectKey: string;
  readonly point: { readonly lat: number; readonly lon: number } | null;
  readonly badge: "gps" | "exif" | "none";
  readonly takenAt: Date | null;
  readonly by: string;
};

// A photo of a record, while the file is open and the record kept, under the record's own limit.
export async function addMedia(db: Database, media: NewMedia, max: number, at: Date): Promise<boolean> {
  const done = await atomically(db, [
    OPEN(media.fileId),
    holds(sql`exists (select 1 from case_record where id = ${media.recordId} and cancelled_reason is null)`),
    holds(sql`(select count(*) from case_media where record_id = ${media.recordId} and erased_at is null) < ${max}`),
    sql`insert into case_media (id, record_id, file_id, kind, object_key, lat, lon, badge, taken_at, by_label, at)
      values (${media.id}, ${media.recordId}, ${media.fileId}, ${media.kind}, ${media.objectKey},
        ${media.point?.lat ?? null}, ${media.point?.lon ?? null}, ${media.badge}, ${media.takenAt}, ${media.by}, ${at})`,
    trailRow(media.fileId, media.recordId, "media", { kind: media.kind, badge: media.badge }, media.by, at),
  ]);
  return done !== null;
}

export const mediaKey = (db: Database, fileId: string, mediaId: string) =>
  row<{ object_key: string; record_id: string }>(
    db,
    sql`select object_key, record_id from case_media where id = ${mediaId} and file_id = ${fileId} and erased_at is null`,
  );

// The file's own values merged in (RFC 7396), or its nil marks, from the revision read.
export async function changeFile(
  db: Database,
  change: {
    readonly fileId: string;
    readonly revision: number;
    readonly fields: Readonly<Record<string, unknown>> | null;
    readonly nil: readonly string[] | null;
    readonly action: "fields" | "nil";
    readonly trail: unknown;
    readonly by: string;
  },
  at: Date,
): Promise<boolean> {
  const done = await atomically(db, [
    sql`update case_file set
        fields = ${change.fields === null ? sql`fields` : sql`json_patch(fields, ${JSON.stringify(change.fields)})`},
        nil = ${change.nil === null ? sql`nil` : JSON.stringify(change.nil)}, revision = revision + 1
      where id = ${change.fileId} and revision = ${change.revision} and status = 'open'`,
    changedOne,
    trailRow(change.fileId, null, change.action, change.trail, change.by, at),
  ]);
  return done !== null;
}

export type MemberRow = {
  readonly id: string;
  readonly fileId: string;
  readonly name: string;
  readonly number: string;
  readonly linkPending: boolean;
  readonly active: boolean;
};

export async function membersOf(db: Database, fileId: string): Promise<MemberRow[]> {
  const found = await rows<{
    id: string;
    file_id: string;
    name: string;
    number: string;
    link_hash: string | null;
    removed_at: string | null;
  }>(
    db,
    sql`select id, file_id, name, number, link_hash, removed_at from case_member where file_id = ${fileId}
      order by added_at, id`,
  );
  return found.map((one) => ({
    id: one.id,
    fileId: one.file_id,
    name: one.name,
    number: one.number,
    linkPending: one.link_hash !== null,
    active: one.removed_at === null,
  }));
}

// A team member, with a one-time link to sign in by.
export const addMember = (
  db: Database,
  member: {
    readonly id: string;
    readonly fileId: string;
    readonly name: string;
    readonly number: string;
    readonly linkHash: string;
    readonly linkExpires: Date;
    readonly by: string;
  },
  at: Date,
) =>
  atomically(db, [
    sql`insert into case_member (id, file_id, name, number, link_hash, link_expires_at, added_by, added_at)
      values (${member.id}, ${member.fileId}, ${member.name}, ${member.number}, ${member.linkHash},
        ${member.linkExpires}, ${member.by}, ${at})`,
    trailRow(member.fileId, null, "memberAdd", { member: member.id }, member.by, at),
  ]);

// A member taken off the team: their cookie and link stop working; what they entered stays.
export async function removeMember(
  db: Database,
  remove: { readonly fileId: string; readonly id: string; readonly by: string },
  at: Date,
): Promise<boolean> {
  const done = await atomically(db, [
    sql`update case_member set removed_at = ${at}, link_hash = null, session_hash = null
      where id = ${remove.id} and file_id = ${remove.fileId} and removed_at is null`,
    changedOne,
    trailRow(remove.fileId, null, "memberRemove", { member: remove.id }, remove.by, at),
  ]);
  return done !== null;
}

// A new link for a member still on the team; the old one stops working.
export async function renewLink(
  db: Database,
  renew: {
    readonly fileId: string;
    readonly id: string;
    readonly linkHash: string;
    readonly linkExpires: Date;
    readonly by: string;
  },
  at: Date,
): Promise<boolean> {
  const done = await atomically(db, [
    sql`update case_member set link_hash = ${renew.linkHash}, link_expires_at = ${renew.linkExpires}
      where id = ${renew.id} and file_id = ${renew.fileId} and removed_at is null`,
    changedOne,
    trailRow(renew.fileId, null, "memberLink", { member: renew.id }, renew.by, at),
  ]);
  return done !== null;
}

// A link exchanged for the member's own cookie, once and before it ends.
export async function exchangeLink(
  db: Database,
  exchange: { readonly linkHash: string; readonly sessionHash: string; readonly sessionExpires: Date },
  at: Date,
): Promise<{ readonly fileId: string } | null> {
  const done = await atomically(db, [
    sql`update case_member set link_hash = null, link_expires_at = null, session_hash = ${exchange.sessionHash},
        session_expires_at = ${exchange.sessionExpires}
      where link_hash = ${exchange.linkHash} and link_expires_at > ${at} and removed_at is null`,
    changedOne,
    sql`select file_id from case_member where session_hash = ${exchange.sessionHash}`,
  ]);
  return done === null ? null : { fileId: ((done[2] as { file_id: string }[])[0] as { file_id: string }).file_id };
}

// The member a cookie stands for, while it lasts; each use moves its end on (Q11).
export async function memberBySession(
  db: Database,
  sessionHash: string,
  at: Date,
  extended: Date,
): Promise<{ readonly id: string; readonly fileId: string; readonly name: string } | null> {
  const found = await row<{ id: string; file_id: string; name: string }>(
    db,
    sql`update case_member set session_expires_at = ${extended}
      where session_hash = ${sessionHash} and session_expires_at > ${at} and removed_at is null
      returning id, file_id, name`,
  );
  return found === null ? null : { id: found.id, fileId: found.file_id, name: found.name };
}

export const logAccess = (
  db: Database,
  access: {
    readonly fileId: string;
    readonly recordId: string | null;
    readonly action: "open" | "reveal" | "media";
    readonly whoId: string;
    readonly whoLabel: string;
  },
  at: Date,
) =>
  atomically(db, [
    sql`insert into case_access (file_id, record_id, action, who_id, who_label, at)
      values (${access.fileId}, ${access.recordId}, ${access.action}, ${access.whoId}, ${access.whoLabel}, ${at})`,
  ]);

// A closing sealed as the file's next version, from the revision read, while the file is open (D14).
export async function closeCase(
  db: Database,
  close: {
    readonly fileId: string;
    readonly revision: number;
    readonly body: string;
    readonly fingerprint: string;
    readonly closing: unknown;
    readonly by: string;
  },
  at: Date,
): Promise<boolean> {
  const done = await atomically(db, [
    sql`update case_file set status = 'proposed', revision = revision + 1
      where id = ${close.fileId} and revision = ${close.revision} and status = 'open'`,
    changedOne,
    sql`insert into case_version (file_id, version, body, fingerprint, sealed_by, at)
      values (${close.fileId},
        (select coalesce(max(version), 0) + 1 from case_version where file_id = ${close.fileId}),
        ${close.body}, ${close.fingerprint}, ${close.by}, ${at})`,
    trailRow(close.fileId, null, "close", close.closing, close.by, at),
  ]);
  return done !== null;
}

export type VersionRow = {
  readonly version: number;
  readonly body: string;
  readonly fingerprint: string;
  readonly sealedBy: string;
  readonly atMs: number;
};

export async function versionsOf(db: Database, fileId: string): Promise<VersionRow[]> {
  const found = await rows<{ version: number; body: string; fingerprint: string; sealed_by: string; at: string }>(
    db,
    sql`select version, body, fingerprint, sealed_by, at from case_version where file_id = ${fileId} order by version`,
  );
  return found.map((one) => ({
    version: one.version,
    body: one.body,
    fingerprint: one.fingerprint,
    sealedBy: one.sealed_by,
    atMs: Date.parse(one.at),
  }));
}

// BNPB accepts a closing (Q2): the file ends in the state its version sealed, five years of personal
// data start now (D23), and the report's ticket closes with it.
export async function acceptCase(
  db: Database,
  accept: {
    readonly fileId: string;
    readonly ticketNumber: string;
    readonly status: "done" | "doneNoted";
    readonly staffId: string;
    readonly by: string;
  },
  at: Date,
): Promise<boolean> {
  const { ticketNumber } = accept;
  const done = await atomically(db, [
    sql`update case_file set status = ${accept.status}, accepted_at = ${at}
      where id = ${accept.fileId} and status = 'proposed'`,
    changedOne,
    trailRow(accept.fileId, null, "accept", { status: accept.status }, accept.by, at),
    sql`insert into ticket_history (ticket_number, from_status, to_status, actor, actor_id, actor_label, note, at)
      select ticket_number, status, 'closed', 'staff', ${accept.staffId}, ${accept.by}, 'Ditutup dari data lanjutan BPBD', ${at}
      from ticket where ticket_number = ${ticketNumber} and status not in ('closed', 'invalid')`,
    historyNotice(ticketNumber, "status", at, IF_WRITTEN),
    sql`update ticket set status = 'closed', revision = revision + 1, updated_at = ${at}
      where ticket_number = ${ticketNumber} and status not in ('closed', 'invalid')`,
  ]);
  return done !== null;
}

// A closed or proposed file opened again by BNPB, with its reason; its old versions stay (D14).
export async function reopenCase(
  db: Database,
  reopen: { readonly fileId: string; readonly reason: string; readonly by: string },
  at: Date,
): Promise<boolean> {
  const done = await atomically(db, [
    sql`update case_file set status = 'open', accepted_at = null, revision = revision + 1
      where id = ${reopen.fileId} and status <> 'open'`,
    changedOne,
    trailRow(reopen.fileId, null, "reopen", { reason: reopen.reason }, reopen.by, at),
  ]);
  return done !== null;
}

// The files whose closing was accepted before the cutoff and whose personal data is still kept.
export const filesToErase = (db: Database, cutoff: Date, limit: number) =>
  rows<{ id: string }>(
    db,
    sql`select id from case_file where accepted_at < ${cutoff} and erased_at is null order by accepted_at limit ${limit}`,
  );

// Faces, and photos of the missing, of a file: deleted with its personal values (D23).
export const personalMedia = (db: Database, fileId: string) =>
  rows<{ id: string; object_key: string }>(
    db,
    sql`select m.id, m.object_key from case_media m join case_record r on r.id = m.record_id
      where m.file_id = ${fileId} and m.erased_at is null and (m.kind = 'face' or r.kind = 'victim')`,
  );

// A file's personal values cleared, its personal media marked gone, and the clearing told in its trail.
export const erasePersonal = (db: Database, fileId: string, mediaIds: readonly string[], at: Date) =>
  atomically(db, [
    sql`update case_record set personal = '{}' where file_id = ${fileId}`,
    sql`update case_member set number = '', link_hash = null, session_hash = null where file_id = ${fileId}`,
    sql`update case_media set erased_at = ${at} where id in (select value from json_each(${JSON.stringify(mediaIds)}))`,
    sql`update case_file set erased_at = ${at} where id = ${fileId}`,
    trailRow(fileId, null, "erase", { media: mediaIds.length }, "Sistem", at),
  ]);
