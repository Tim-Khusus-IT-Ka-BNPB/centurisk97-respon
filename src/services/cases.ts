import {
  acceptCase,
  addMedia,
  addMember,
  addRecord,
  type CaseFileRow,
  type CaseRecordRow,
  cancelRecord,
  caseById,
  caseOfTicket,
  casesIn,
  changeFile,
  changeRecord,
  closeCase,
  erasePersonal,
  exchangeLink,
  filesToErase,
  logAccess,
  mediaKey,
  memberBySession,
  membersOf,
  openCase,
  personalMedia,
  recordsOf,
  removeMember,
  renewLink,
  reopenCase,
  type VersionRow,
  versionsOf,
} from "../adapters/d1/cases";
import { deskReport } from "../adapters/d1/desk";
import type { CaseView } from "../contract/cases";
import {
  type CaseRecord,
  dropFilledNil,
  finalState,
  flagsOf,
  metricsWithRecords,
  NIL_METRICS,
  recapOf,
  recordPoint,
  sealedBody,
} from "../domain/caseRecap";
import {
  type CaseKind,
  type CaseValues,
  checkClosing,
  checkFileFields,
  checkRecord,
  faceAllowed,
  maskPersonal,
  photosMissing,
} from "../domain/caseSpec";
import { mayUse } from "../domain/deskRights";
import { localDate } from "../domain/eventTime";
import type { Point } from "../domain/geo";
import { PROOF } from "../domain/handling";
import { isJpeg, readExif, stripJpeg } from "../domain/jpeg";
import { normaliseNumber } from "../domain/phoneNumber";
import { type DeviceFix, PHOTO, takenAt, usableFix } from "../domain/photoChecks";
import { DAY_MS } from "../domain/time";
import { hmacKey, sha256Hex } from "../platform/keys";
import type { StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { admitted, type Refused } from "./desk";
import { at } from "./draftView";

// The BPBD's follow-up files (upstream "Data lanjutan BPBD", M09), on the web only: the regency's
// BPBD accounts keep a file and its team; members sign in by a one-time link; BNPB reads every
// file with personal values masked until it asks for one in full, and every opening is logged.

export type CaseMember = { readonly id: string; readonly fileId: string; readonly name: string };
export type CaseActor =
  | { readonly kind: "staff"; readonly staff: StaffPrincipal }
  | { readonly kind: "member"; readonly member: CaseMember };

// What the actor may do with the file: keep it, fill it, read it masked, or read its totals only.
type Access = "lead" | "team" | "bnpb" | "province";

function accessOf(actor: CaseActor, file: CaseFileRow): Access | null {
  if (actor.kind === "member") return actor.member.fileId === file.id ? "team" : null;
  // Both desk roles read files; the region decides how.
  const { scope } = actor.staff;
  if (scope.level === "national") return "bnpb";
  if (scope.level === "regency") return scope.code === file.regencyCode ? "lead" : null;
  return file.regencyCode.startsWith(`${scope.code}.`) ? "province" : null;
}

const whoOf = (actor: CaseActor) =>
  actor.kind === "staff"
    ? { id: actor.staff.staffId, label: actor.staff.label }
    : { id: `member:${actor.member.id}`, label: actor.member.name };

// Links and cookies last 30 days, a cookie moved on with each use (Q11).
const LINK_DAYS = 30;
const MAX_MEDIA = 6;
const MEMBER_COOKIE = "lapor_data";
export const CASE_COOKIE = MEMBER_COOKIE;

const randomHex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((one) => one.toString(16).padStart(2, "0")).join("");

// The member a cookie stands for, or null.
export async function caseMemberOf(bindings: ServiceBindings, cookie: string | undefined): Promise<CaseMember | null> {
  if (cookie === undefined || !/^[0-9a-f]{64}$/.test(cookie)) return null;
  const now = bindings.clock.now();
  return memberBySession(bindings.db, await sha256Hex(cookie), new Date(now), new Date(now + LINK_DAYS * DAY_MS));
}

export type CaseAnswer<T> = { readonly kind: "ok"; readonly body: T } | Refused | { readonly kind: "closed" };

// A file opened from a report by the BPBD of the report's own regency; opened twice, it is one file.
export async function openCaseFile(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
): Promise<CaseAnswer<{ readonly fileId: string }>> {
  const refused = await admitted(bindings, staff, "leadCase", "desk.write");
  if (refused) return refused;
  const found = await deskReport(bindings.db, staff.scope, ticketNumber);
  if (found === null || staff.scope.level !== "regency") return { kind: "notFound" };
  await openCase(
    bindings.db,
    { id: randomHex(8), ticketNumber, regencyCode: found.villageCode.slice(0, 5), by: staff.label },
    new Date(bindings.clock.now()),
  );
  return { kind: "ok", body: { fileId: (await caseOfTicket(bindings.db, ticketNumber))?.id as string } };
}

// The file a report has, for its desk page, and whether this account may open one: the BPBD of the
// report's own regency. Null for an account that reads no file of it.
export async function caseOfReport(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
  regencyCode: string,
) {
  const file = await caseOfTicket(bindings.db, ticketNumber);
  const mayOpen = mayUse(staff.role, "leadCase") && staff.scope.level === "regency" && staff.scope.code === regencyCode;
  if (file === null) return mayOpen ? { file: null, mayOpen } : null;
  return accessOf({ kind: "staff", staff }, file) === null
    ? null
    : { file: { id: file.id, status: file.status }, mayOpen };
}

const asRecord = (one: CaseRecordRow): CaseRecord => ({
  id: one.id,
  kind: one.kind,
  seq: one.seq,
  data: one.data,
  personal: one.personal,
  point: recordPoint(one.point, one.media),
  cancelled: one.cancelledReason !== null,
});

const today = (bindings: ServiceBindings) => localDate(bindings.clock.now(), "WIB");

// One file as its reader may see it: the team and its keepers in full, BNPB masked, a province its
// totals only. Each opening is logged (D22).
export async function caseView(
  bindings: ServiceBindings,
  actor: CaseActor,
  fileId: string,
): Promise<CaseAnswer<CaseView>> {
  const file = await caseById(bindings.db, fileId);
  const access = file === null ? null : accessOf(actor, file);
  if (file === null || access === null) return { kind: "notFound" };
  const who = whoOf(actor);
  const now = new Date(bindings.clock.now());
  await logAccess(bindings.db, { fileId, recordId: null, action: "open", whoId: who.id, whoLabel: who.label }, now);
  const [stored, report, versions] = await Promise.all([
    recordsOf(bindings.db, fileId),
    deskReport(bindings.db, { level: "national" }, file.ticketNumber),
    versionsOf(bindings.db, fileId),
  ]);
  const records = stored.map(asRecord);
  const day = today(bindings);
  const recap = recapOf(records, new Set(file.nil), day);
  // A file's report is always there: the file is tied to its ticket.
  const eventMs = (report as NonNullable<typeof report>).sentAt.getTime();
  const shown = access === "province" ? [] : stored;
  const members = access === "lead" || access === "bnpb" ? await membersOf(bindings.db, fileId) : [];
  return {
    kind: "ok",
    body: {
      file: {
        id: file.id,
        ticketNumber: file.ticketNumber,
        regencyCode: file.regencyCode,
        status: file.status,
        fields: file.fields,
        nil: [...file.nil],
        revision: file.revision,
        openedAt: at(file.openedAtMs, "WIB"),
      },
      access,
      day,
      recap,
      final: ((final) => ({ ...final, reasons: [...final.reasons], notRecorded: [...final.notRecorded] }))(
        finalState(recap),
      ),
      filled: [...metricsWithRecords(records)],
      records: shown.map((one) => {
        const record = records[stored.indexOf(one)] as CaseRecord;
        return {
          id: one.id,
          kind: one.kind,
          seq: one.seq,
          data: one.data,
          personal: access === "bnpb" ? maskPersonal(one.personal) : one.personal,
          point: one.point,
          shownPoint: record.point,
          cancelledReason: one.cancelledReason,
          revision: one.revision,
          by: one.byLabel,
          updatedAt: at(one.updatedAtMs, "WIB"),
          media: one.media.map((item) => ({ id: item.id, kind: item.kind, badge: item.badge })),
          flags: flagsOf(record, { others: records, media: one.media, eventMs, inRegency: () => true }),
          missingPhotos: photosMissing(one.kind, one.data, one.media),
        };
      }),
      versions: versions.map((one) => {
        const sealed = JSON.parse(one.body) as {
          final: CaseView["final"];
          closing: { endedOn: string; note: string | null };
        };
        return {
          version: one.version,
          at: at(one.atMs, "WIB"),
          by: one.sealedBy,
          fingerprint: one.fingerprint,
          final: sealed.final,
          closing: sealed.closing,
        };
      }),
      members: members.map((one) => ({
        id: one.id,
        name: one.name,
        number: access === "bnpb" ? (maskPersonal({ number: one.number }).number as string) : one.number,
        active: one.active,
        linkPending: one.linkPending,
      })),
    },
  };
}

// One record's personal values in full for BNPB, logged each time (Q6, D22).
export async function revealRecord(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  fileId: string,
  recordId: string,
): Promise<CaseAnswer<{ readonly personal: CaseValues }>> {
  const refused = await admitted(bindings, staff, "revealCase", "desk.read");
  if (refused) return refused;
  const found = (await recordsOf(bindings.db, fileId)).find((one) => one.id === recordId);
  if (found === undefined) return { kind: "notFound" };
  await logAccess(
    bindings.db,
    { fileId, recordId, action: "reveal", whoId: staff.staffId, whoLabel: staff.label },
    new Date(bindings.clock.now()),
  );
  return { kind: "ok", body: { personal: found.personal } };
}

export type RecordAnswer =
  | CaseAnswer<{ readonly recordId: string }>
  | { readonly kind: "invalid"; readonly errors: readonly string[] }
  | { readonly kind: "changed" };

type Writable = { readonly file: CaseFileRow; readonly records: CaseRecordRow[]; readonly by: string };

// A file this actor may fill, open, with its records as they stand.
async function writable(
  bindings: ServiceBindings,
  actor: CaseActor,
  fileId: string,
): Promise<Writable | Refused | { readonly kind: "closed" }> {
  if (actor.kind === "staff") {
    const refused = await admitted(bindings, actor.staff, "leadCase", "desk.write");
    if (refused) return refused;
  }
  const file = await caseById(bindings.db, fileId);
  const access = file === null ? null : accessOf(actor, file);
  if (file === null || (access !== "lead" && access !== "team")) return { kind: "notFound" };
  if (file.status !== "open") return { kind: "closed" };
  return { file, records: await recordsOf(bindings.db, fileId), by: whoOf(actor).label };
}

const isWritable = (found: Awaited<ReturnType<typeof writable>>): found is Writable => "file" in found;

// A live record of a file this actor may fill, with the writer's label.
export async function caseRecordFor(bindings: ServiceBindings, actor: CaseActor, fileId: string, recordId: string) {
  const found = await writable(bindings, actor, fileId);
  if (!isWritable(found)) return found;
  const record = found.records.find((one) => one.id === recordId && one.cancelledReason === null);
  return record === undefined ? ({ kind: "notFound" } as const) : ({ kind: "record", record, by: found.by } as const);
}

// A record's references: an evacuee's shelter and head of family, a need's shelter, each a live record
// of the right kind in this file.
function referencesHold(kind: CaseKind, data: CaseValues, records: readonly CaseRecordRow[], self: string | null) {
  const live = (id: unknown, wanted: CaseKind) =>
    records.some((one) => one.id === id && one.kind === wanted && one.cancelledReason === null && one.id !== self);
  const errors: string[] = [];
  if (data.shelter !== undefined && !live(data.shelter, "shelter")) errors.push("shelter");
  if (kind === "evacuee" && data.head !== "self" && !live(data.head, "evacuee")) errors.push("head");
  return errors;
}

// The trail keeps general values in full and personal ones by a keyed fingerprint only (D4).
async function trailOf(bindings: ServiceBindings, kind: CaseKind, data: CaseValues, personal: CaseValues) {
  const prints = await Promise.all(
    Object.entries(personal).map(async ([id, value]) => [
      id,
      (await hmacKey(bindings.settings.keyHmacSecret, "case", JSON.stringify(value))).slice(0, 16),
    ]),
  );
  return { kind, data, personal: Object.fromEntries(prints) };
}

const pointOrNull = (point: Point | null | undefined): Point | null => point ?? null;

// A new record, checked against its kind and its references; a metric it fills is no longer nil.
export async function saveRecord(
  bindings: ServiceBindings,
  actor: CaseActor,
  fileId: string,
  input: {
    readonly kind: CaseKind;
    readonly values: CaseValues;
    readonly point?: Point | null;
    readonly clientId?: string;
  },
): Promise<RecordAnswer> {
  const found = await writable(bindings, actor, fileId);
  if (!isWritable(found)) return found;
  const checked = checkRecord(input.kind, input.values);
  const errors = [...checked.errors, ...referencesHold(input.kind, checked.data, found.records, null)];
  if (errors.length > 0) return { kind: "invalid", errors };
  const id = randomHex(8);
  const after = [
    ...found.records.map(asRecord),
    { id, kind: input.kind, seq: 0, data: checked.data, personal: checked.personal, point: null, cancelled: false },
  ];
  const saved = await addRecord(
    bindings.db,
    {
      id,
      fileId,
      kind: input.kind,
      data: checked.data,
      personal: checked.personal,
      point: pointOrNull(input.point),
      by: found.by,
      trail: await trailOf(bindings, input.kind, checked.data, checked.personal),
      nil: [...dropFilledNil(new Set(found.file.nil), after)],
      clientId: input.clientId ?? null,
    },
    new Date(bindings.clock.now()),
  );
  return saved === null ? { kind: "closed" } : { kind: "ok", body: { recordId: saved } };
}

// A record's values changed from the revision its writer read.
export async function updateRecord(
  bindings: ServiceBindings,
  actor: CaseActor,
  fileId: string,
  recordId: string,
  input: { readonly values: CaseValues; readonly point?: Point | null; readonly revision: number },
): Promise<RecordAnswer> {
  const found = await writable(bindings, actor, fileId);
  if (!isWritable(found)) return found;
  const record = found.records.find((one) => one.id === recordId && one.cancelledReason === null);
  if (record === undefined) return { kind: "notFound" };
  const checked = checkRecord(record.kind, input.values);
  const errors = [...checked.errors, ...referencesHold(record.kind, checked.data, found.records, recordId)];
  if (errors.length > 0) return { kind: "invalid", errors };
  const after = found.records.map((one) =>
    one.id === recordId ? { ...asRecord(one), data: checked.data, personal: checked.personal } : asRecord(one),
  );
  const done = await changeRecord(
    bindings.db,
    {
      id: recordId,
      fileId,
      kind: record.kind,
      data: checked.data,
      personal: checked.personal,
      point: input.point === undefined ? record.point : input.point,
      by: found.by,
      trail: await trailOf(bindings, record.kind, checked.data, checked.personal),
      nil: [...dropFilledNil(new Set(found.file.nil), after)],
      revision: input.revision,
    },
    new Date(bindings.clock.now()),
  );
  return done ? { kind: "ok", body: { recordId } } : { kind: "changed" };
}

// A record entered by mistake, set aside with its reason.
export async function cancelCaseRecord(
  bindings: ServiceBindings,
  actor: CaseActor,
  fileId: string,
  recordId: string,
  typedReason: string,
): Promise<RecordAnswer> {
  const found = await writable(bindings, actor, fileId);
  if (!isWritable(found)) return found;
  const reason = typedReason.trim().replace(/\s+/g, " ");
  if (reason.length < 3 || reason.length > 300) return { kind: "invalid", errors: ["reason"] };
  const done = await cancelRecord(
    bindings.db,
    { fileId, id: recordId, reason, by: found.by },
    new Date(bindings.clock.now()),
  );
  return done ? { kind: "ok", body: { recordId } } : { kind: "notFound" };
}

export type PhotoAnswer = RecordAnswer | { readonly kind: "photoRefused"; readonly rule: string };

// A photo of a record from a camera, its metadata stripped: its point from the phone's reading when
// good enough, else from the photo (badge gps or exif); a face only where one is allowed (Q10, Q13).
export async function addRecordPhoto(
  bindings: ServiceBindings,
  actor: CaseActor,
  fileId: string,
  recordId: string,
  upload: { readonly bytes: Uint8Array; readonly face: boolean; readonly device: DeviceFix | null },
): Promise<PhotoAnswer> {
  const found = await writable(bindings, actor, fileId);
  if (!isWritable(found)) return found;
  const record = found.records.find((one) => one.id === recordId && one.cancelledReason === null);
  if (record === undefined) return { kind: "notFound" };
  if (upload.face && !faceAllowed(record.kind, record.data)) return { kind: "photoRefused", rule: "faceNotAsked" };
  const { bytes } = upload;
  if (!isJpeg(bytes) || bytes.length < PHOTO.minBytes || bytes.length > PROOF.maxBytes)
    return { kind: "photoRefused", rule: "proofFormat" };
  const exif = readExif(bytes);
  if (exif === null || !exif.camera) return { kind: "photoRefused", rule: "notCamera" };
  const clean = stripJpeg(bytes);
  if (clean === null) return { kind: "photoRefused", rule: "broken" };
  const now = bindings.clock.now();
  const fix = usableFix(upload.device, now);
  const id = crypto.randomUUID();
  const objectKey = `cases/${fileId}/${id}.jpg`;
  await bindings.photos.put(objectKey, clean);
  const taken = takenAt(exif, 420);
  const kept = await addMedia(
    bindings.db,
    {
      id,
      fileId,
      recordId,
      kind: upload.face ? "face" : "photo",
      objectKey,
      point: fix ?? exif.point,
      badge: fix !== null ? "gps" : exif.point !== null ? "exif" : "none",
      takenAt: taken === null ? null : new Date(taken),
      by: found.by,
    },
    MAX_MEDIA,
    new Date(now),
  );
  if (kept) return { kind: "ok", body: { recordId } };
  await bindings.photos.delete([objectKey]);
  return { kind: "photoRefused", rule: "proofTooMany" };
}

// A photo or video of a record, to whoever may read the file; logged (D22).
const VIDEO_TYPES: Readonly<Record<string, string>> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

export async function recordMedia(
  bindings: ServiceBindings,
  actor: CaseActor,
  fileId: string,
  mediaId: string,
): Promise<CaseAnswer<{ readonly bytes: Uint8Array; readonly contentType: string }>> {
  const file = await caseById(bindings.db, fileId);
  const access = file === null ? null : accessOf(actor, file);
  if (access === null || access === "province") return { kind: "notFound" };
  const found = await mediaKey(bindings.db, fileId, mediaId);
  if (found === null) return { kind: "notFound" };
  const bytes = await bindings.photos.get(found.object_key);
  if (bytes === null) return { kind: "notFound" };
  const who = whoOf(actor);
  await logAccess(
    bindings.db,
    { fileId, recordId: found.record_id, action: "media", whoId: who.id, whoLabel: who.label },
    new Date(bindings.clock.now()),
  );
  return {
    kind: "ok",
    body: { bytes, contentType: found.container === null ? "image/jpeg" : (VIDEO_TYPES[found.container] as string) },
  };
}

export type LeadAnswer<T> =
  | CaseAnswer<T>
  | { readonly kind: "invalid"; readonly errors: readonly string[] }
  | { readonly kind: "changed" };

// A file only its regency's BPBD keeps: its values, its nil marks and its team.
async function leadFile(bindings: ServiceBindings, staff: StaffPrincipal, fileId: string) {
  const refused = await admitted(bindings, staff, "leadCase", "desk.write");
  if (refused) return refused;
  const file = await caseById(bindings.db, fileId);
  if (file === null || accessOf({ kind: "staff", staff }, file) !== "lead") return { kind: "notFound" } as const;
  return file;
}

// The file's own values (F-9), from the revision read.
export async function setCaseFields(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  fileId: string,
  input: { readonly fields: unknown; readonly revision: number },
): Promise<LeadAnswer<{ readonly fileId: string }>> {
  const file = await leadFile(bindings, staff, fileId);
  if (!("id" in file)) return file;
  if (file.status !== "open") return { kind: "closed" };
  const now = bindings.clock.now();
  const checked = checkFileFields(
    input.fields,
    today(bindings),
    typeof (file.fields.post as { name?: unknown } | undefined)?.name === "string",
  );
  if (checked.errors.length > 0) return { kind: "invalid", errors: checked.errors };
  const done = await changeFile(
    bindings.db,
    {
      fileId,
      revision: input.revision,
      fields: checked.patch,
      nil: null,
      action: "fields",
      trail: checked.patch,
      by: staff.label,
    },
    new Date(now),
  );
  return done ? { kind: "ok", body: { fileId } } : { kind: "changed" };
}

// A metric marked none, different from not yet recorded (D15); one with records cannot be.
export async function setCaseNil(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  fileId: string,
  input: { readonly metric: string; readonly nil: boolean; readonly revision: number },
): Promise<LeadAnswer<{ readonly fileId: string }>> {
  const file = await leadFile(bindings, staff, fileId);
  if (!("id" in file)) return file;
  if (file.status !== "open") return { kind: "closed" };
  const records = (await recordsOf(bindings.db, fileId)).map(asRecord);
  if (!NIL_METRICS.has(input.metric) || (input.nil && metricsWithRecords(records).has(input.metric)))
    return { kind: "invalid", errors: ["metric"] };
  const nil = input.nil ? [...new Set([...file.nil, input.metric])] : file.nil.filter((one) => one !== input.metric);
  const done = await changeFile(
    bindings.db,
    {
      fileId,
      revision: input.revision,
      fields: null,
      nil,
      action: "nil",
      trail: { metric: input.metric, nil: input.nil },
      by: staff.label,
    },
    new Date(bindings.clock.now()),
  );
  return done ? { kind: "ok", body: { fileId } } : { kind: "changed" };
}

const newLink = async (bindings: ServiceBindings) => {
  const token = randomHex(16);
  return {
    token,
    hash: await sha256Hex(token),
    expires: new Date(bindings.clock.now() + LINK_DAYS * DAY_MS),
    url: `${bindings.settings.appOrigin}/lapor/data/masuk/${token}`,
  };
};

// A team member by name and number (D11, Q5): their link is shown once, for the keeper to send.
export async function addCaseMember(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  fileId: string,
  input: { readonly name: string; readonly number: string },
): Promise<LeadAnswer<{ readonly memberId: string; readonly link: string }>> {
  const file = await leadFile(bindings, staff, fileId);
  if (!("id" in file)) return file;
  const name = input.name.trim().replace(/\s+/g, " ");
  const number = normaliseNumber(input.number);
  const errors = [...(name.length < 2 || name.length > 80 ? ["name"] : []), ...(number === null ? ["number"] : [])];
  if (errors.length > 0) return { kind: "invalid", errors };
  const link = await newLink(bindings);
  const memberId = randomHex(8);
  await addMember(
    bindings.db,
    {
      id: memberId,
      fileId,
      name,
      number: number as string,
      linkHash: link.hash,
      linkExpires: link.expires,
      by: staff.label,
    },
    new Date(bindings.clock.now()),
  );
  return { kind: "ok", body: { memberId, link: link.url } };
}

// A member taken off the team by the file's keepers or by BNPB.
export async function removeCaseMember(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  fileId: string,
  memberId: string,
): Promise<LeadAnswer<{ readonly memberId: string }>> {
  const refused = await admitted(bindings, staff, "readCases", "desk.write");
  if (refused) return refused;
  const file = await caseById(bindings.db, fileId);
  const access = file === null ? null : accessOf({ kind: "staff", staff }, file);
  if (access !== "lead" && access !== "bnpb") return { kind: "notFound" };
  const done = await removeMember(
    bindings.db,
    { fileId, id: memberId, by: staff.label },
    new Date(bindings.clock.now()),
  );
  return done ? { kind: "ok", body: { memberId } } : { kind: "notFound" };
}

// A new link for a member who lost theirs; the old one stops working.
export async function renewCaseLink(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  fileId: string,
  memberId: string,
): Promise<LeadAnswer<{ readonly memberId: string; readonly link: string }>> {
  const file = await leadFile(bindings, staff, fileId);
  if (!("id" in file)) return file;
  const link = await newLink(bindings);
  const done = await renewLink(
    bindings.db,
    { fileId, id: memberId, linkHash: link.hash, linkExpires: link.expires, by: staff.label },
    new Date(bindings.clock.now()),
  );
  return done ? { kind: "ok", body: { memberId, link: link.url } } : { kind: "notFound" };
}

// A link exchanged for the member's own cookie (D20): once, before it ends.
export async function exchangeCaseLink(
  bindings: ServiceBindings,
  token: string,
): Promise<{ readonly fileId: string; readonly cookie: string; readonly maxAge: number } | null> {
  const cookie = randomHex(32);
  const now = bindings.clock.now();
  const done = await exchangeLink(
    bindings.db,
    {
      linkHash: await sha256Hex(token),
      sessionHash: await sha256Hex(cookie),
      sessionExpires: new Date(now + LINK_DAYS * DAY_MS),
    },
    new Date(now),
  );
  return done === null ? null : { fileId: done.fileId, cookie, maxAge: LINK_DAYS * 24 * 3600 };
}

// The files a staff account may read, newest first: all for BNPB, a region's for its BPBD.
export async function caseList(bindings: ServiceBindings, staff: StaffPrincipal) {
  const refused = await admitted(bindings, staff, "readCases", "desk.read");
  if (refused) return refused;
  const prefix = staff.scope.level === "national" ? null : staff.scope.code;
  const files = await casesIn(bindings.db, prefix);
  return {
    kind: "ok" as const,
    body: {
      files: files.map((one) => ({
        id: one.id,
        ticketNumber: one.ticketNumber,
        regencyCode: one.regencyCode,
        status: one.status,
        openedAt: at(one.openedAtMs, "WIB"),
      })),
    },
  };
}

// The keepers close the file (K3, D13): its totals on the day the event ended, the state it ends in,
// sealed as a version with no personal value, waiting for BNPB to accept (Q2).
export async function closeCaseFile(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  fileId: string,
  input: { readonly endedOn: string; readonly note: string; readonly revision: number },
): Promise<LeadAnswer<{ readonly fileId: string }>> {
  const file = await leadFile(bindings, staff, fileId);
  if (!("id" in file)) return file;
  if (file.status !== "open") return { kind: "closed" };
  const checked = checkClosing(input, localDate(file.openedAtMs, "WIB"), today(bindings));
  if (checked.errors.length > 0) return { kind: "invalid", errors: checked.errors };
  const records = (await recordsOf(bindings.db, fileId)).map(asRecord);
  const recap = recapOf(records, new Set(file.nil), checked.closing.endedOn);
  const final = finalState(recap);
  const body = await sealedBody(file, records, { recap, final, closing: checked.closing }, async (text: string) =>
    hmacKey(bindings.settings.keyHmacSecret, "case", text),
  );
  const done = await closeCase(
    bindings.db,
    {
      fileId,
      revision: input.revision,
      body,
      fingerprint: await sha256Hex(body),
      closing: { ...checked.closing, status: final.status },
      by: staff.label,
    },
    new Date(bindings.clock.now()),
  );
  return done ? { kind: "ok", body: { fileId } } : { kind: "changed" };
}

// BNPB accepts a closing as sealed: the file ends in its sealed state and its report's ticket closes.
export async function acceptCaseFile(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  fileId: string,
): Promise<LeadAnswer<{ readonly fileId: string }>> {
  const refused = await admitted(bindings, staff, "acceptCase", "desk.write");
  if (refused) return refused;
  const file = await caseById(bindings.db, fileId);
  if (file === null) return { kind: "notFound" };
  if (file.status !== "proposed") return { kind: "changed" };
  const sealed = (await versionsOf(bindings.db, fileId)).at(-1) as VersionRow;
  const { final } = JSON.parse(sealed.body) as { final: { status: "done" | "doneNoted" } };
  const done = await acceptCase(
    bindings.db,
    { fileId, ticketNumber: file.ticketNumber, status: final.status, staffId: staff.staffId, by: staff.label },
    new Date(bindings.clock.now()),
  );
  return done ? { kind: "ok", body: { fileId } } : { kind: "changed" };
}

// BNPB opens a proposed or closed file again, with its reason: a mistyped closing, or a person
// found after (K11, ALUR 8). The versions sealed before stay.
export async function reopenCaseFile(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  fileId: string,
  typedReason: string,
): Promise<LeadAnswer<{ readonly fileId: string }>> {
  const refused = await admitted(bindings, staff, "acceptCase", "desk.write");
  if (refused) return refused;
  const reason = typedReason.trim().replace(/\s+/g, " ");
  if (reason.length < 3 || reason.length > 300) return { kind: "invalid", errors: ["reason"] };
  if ((await caseById(bindings.db, fileId)) === null) return { kind: "notFound" };
  const done = await reopenCase(bindings.db, { fileId, reason, by: staff.label }, new Date(bindings.clock.now()));
  return done ? { kind: "ok", body: { fileId } } : { kind: "changed" };
}

// Five years after a closing was accepted, a file's personal values and its faces and photos of the
// missing go (K9, D23), a few files each run; its other values, totals, trail and versions stay.
export const ERASE_AFTER_MS = 5 * 365 * DAY_MS;
const ERASE_BATCH = 20;

export async function erasePersonalData(bindings: Pick<ServiceBindings, "db" | "photos" | "clock">): Promise<number> {
  const now = bindings.clock.now();
  const files = await filesToErase(bindings.db, new Date(now - ERASE_AFTER_MS), ERASE_BATCH);
  for (const { id } of files) {
    const media = await personalMedia(bindings.db, id);
    if (media.length > 0) await bindings.photos.delete(media.map((one) => one.object_key));
    await erasePersonal(
      bindings.db,
      id,
      media.map((one) => one.id),
      new Date(now),
    );
  }
  return files.length;
}
