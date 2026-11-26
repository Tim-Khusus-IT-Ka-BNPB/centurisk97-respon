import {
  addMissing,
  type MissingRow,
  missingHistory,
  missingList,
  missingOf,
  missingPhotoKey,
  moveMissing,
  ownMissing,
} from "../adapters/d1/missingPersons";
import { activeVillage } from "../adapters/d1/places";
import { knownProfiles } from "../adapters/d1/reporters";
import { stripJpeg } from "../domain/jpeg";
import {
  MISSING_PER_DAY,
  type MissingError,
  type MissingInput,
  type MissingStatus,
  mayMoveMissing,
  readMissing,
} from "../domain/missingPerson";
import { CHAT_PHOTO } from "../domain/photoChecks";
import type { Principal, StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { admitted, type DeskAnswer } from "./desk";
import { at, draftZone } from "./draftView";

type Reporter = Extract<Principal, { kind: "device" | "session" }>;

export type MissingSubmit =
  | { readonly kind: "sent"; readonly id: string }
  | { readonly kind: "unknownReporter" }
  | { readonly kind: "unknownPlace" }
  | { readonly kind: "tooMany" }
  | { readonly kind: "badPhoto" }
  | { readonly kind: "invalid"; readonly errors: readonly MissingError[] };

// A missing person, reported under the reporter last used on this phone or in this session, from the
// village where they were last seen. One photo may come from the gallery, an old one too.
export async function reportMissing(
  bindings: ServiceBindings,
  principal: Reporter,
  input: MissingInput & { readonly villageCode: string },
  photo: Uint8Array | null,
): Promise<MissingSubmit> {
  const where = principal.kind === "device" ? { deviceId: principal.deviceId } : { reporterId: principal.reporterId };
  const nowMs = bindings.clock.now();
  const [profile] = await knownProfiles(bindings.db, where, new Date(nowMs));
  if (profile === undefined) return { kind: "unknownReporter" };
  const village = await activeVillage(bindings.db, input.villageCode);
  if (village === null) return { kind: "unknownPlace" };
  const person = readMissing(input, nowMs, draftZone(village.villageCode));
  if (Array.isArray(person)) return { kind: "invalid", errors: person };
  const clean = photo === null ? null : photo.length > CHAT_PHOTO.maxBytes ? null : stripJpeg(photo);
  if (photo !== null && clean === null) return { kind: "badPhoto" };
  const id = crypto.randomUUID();
  const photoKey = clean === null ? null : `missing/${id}.jpg`;
  if (clean !== null) await bindings.photos.put(photoKey as string, clean);
  const added = await addMissing(
    bindings.db,
    {
      id,
      reporterId: profile.reporter_id,
      numberKey: profile.number_key,
      ownerSlot: profile.owner_slot,
      reporterName: profile.name,
      villageCode: village.villageCode,
      place: {
        villageName: village.villageName,
        districtName: village.districtName,
        regencyName: village.regencyName,
        provinceName: village.provinceName,
      },
      person: person as Exclude<typeof person, readonly MissingError[]>,
      photoKey,
      at: new Date(nowMs),
    },
    MISSING_PER_DAY,
  );
  if (!added) {
    if (photoKey !== null) await bindings.photos.delete([photoKey]);
    return { kind: "tooMany" };
  }
  return { kind: "sent", id };
}

const viewOf = (one: MissingRow) => {
  const zone = draftZone(one.village_code);
  return {
    id: one.id,
    status: one.status,
    place: JSON.parse(one.place) as {
      villageName: string;
      districtName: string;
      regencyName: string;
      provinceName: string;
    },
    name: one.name,
    nickname: one.nickname,
    relation: one.relation,
    sex: one.sex,
    age: one.age,
    clothes: one.clothes,
    marks: one.marks,
    lastSeen: { date: one.last_seen_date, time: one.last_seen_time, zone },
    personNumber: one.person_number,
    contactNumber: one.contact_number,
    waitPlace: one.wait_place,
    reporterName: one.reporter_name,
    hasPhoto: one.photo_key !== null,
    createdAt: at(Date.parse(one.created_at), zone),
  };
};

export type MissingView = ReturnType<typeof viewOf>;

// Every officer of a region reads its missing persons; numbers stay with officers.
export async function deskMissing(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  status: MissingStatus | null,
): Promise<DeskAnswer<{ items: MissingView[] }>> {
  const refused = await admitted(bindings, staff, "readQueue", "desk.read");
  if (refused) return refused;
  return { kind: "ok", body: { items: (await missingList(bindings.db, staff.scope, status)).map(viewOf) } };
}

export async function deskMissingOne(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  id: string,
): Promise<
  DeskAnswer<
    MissingView & {
      history: { status: MissingStatus; note: string | null; actor: string | null; at: ReturnType<typeof at> }[];
    }
  >
> {
  const refused = await admitted(bindings, staff, "readReport", "desk.read");
  if (refused) return refused;
  const found = await missingOf(bindings.db, staff.scope, id);
  if (found === null) return { kind: "notFound" };
  const zone = draftZone(found.village_code);
  const history = (await missingHistory(bindings.db, id)).map((one) => ({
    status: one.to_status,
    note: one.note,
    actor: one.staff_label,
    at: at(Date.parse(one.at), zone),
  }));
  return { kind: "ok", body: { ...viewOf(found), history } };
}

export type MissingMove = DeskAnswer<{ status: MissingStatus }> | { readonly kind: "refusedMove" };

// Found safe, found dead, handed to SAR, closed, or open again; each with its history row.
export async function moveDeskMissing(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  id: string,
  to: MissingStatus,
  note: string,
): Promise<MissingMove> {
  const refused = await admitted(bindings, staff, "moveTicket", "desk.write");
  if (refused) return refused;
  const found = await missingOf(bindings.db, staff.scope, id);
  if (found === null) return { kind: "notFound" };
  if (!mayMoveMissing(found.status, to)) return { kind: "refusedMove" };
  const moved = await moveMissing(
    bindings.db,
    id,
    found.status,
    to,
    note.trim() === "" ? null : note.trim().slice(0, 300),
    staff,
    new Date(bindings.clock.now()),
  );
  return moved ? { kind: "ok", body: { status: to } } : { kind: "refusedMove" };
}

export async function deskMissingPhoto(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  id: string,
): Promise<{ readonly kind: "file"; readonly bytes: Uint8Array } | Exclude<DeskAnswer<never>, { kind: "ok" }>> {
  const refused = await admitted(bindings, staff, "readReport", "desk.read");
  if (refused) return refused;
  const key = await missingPhotoKey(bindings.db, staff.scope, id);
  const bytes = key === null ? null : await bindings.photos.get(key);
  return bytes === null ? { kind: "notFound" } : { kind: "file", bytes };
}

// The reporter's own missing-person reports, for Laporan saya.
export async function myMissing(bindings: ServiceBindings, principal: Reporter) {
  const where = principal.kind === "device" ? { deviceId: principal.deviceId } : { reporterId: principal.reporterId };
  const profiles = await knownProfiles(bindings.db, where, new Date(bindings.clock.now()));
  const all = await Promise.all(
    profiles.map((profile) => ownMissing(bindings.db, profile.reporter_id, profile.owner_slot)),
  );
  return all
    .flat()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((one) => ({
      id: one.id,
      name: one.name,
      status: one.status,
      villageName: (JSON.parse(one.place) as { villageName: string }).villageName,
      createdAt: one.created_at,
    }));
}
