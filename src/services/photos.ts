import { type DraftRecord, loadDraft, photoAdded, storedReply, storeReply } from "../adapters/d1/drafts";
import { draftPhotos, insertPhoto, photoOf } from "../adapters/d1/photos";
import { villageCentre } from "../adapters/d1/places";
import { zoneOffsetMs } from "../domain/eventTime";
import type { PlaceValue } from "../domain/fieldState";
import type { Point } from "../domain/geo";
import { readExif, stripJpeg } from "../domain/jpeg";
import { checkPhoto, type DeviceFix } from "../domain/photoChecks";
import { MINUTE_MS } from "../domain/time";
import { type DraftContent, photoMax } from "../domain/turn/content";
import { atomically, changedOne } from "../platform/database";
import type { Principal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { draftZone } from "./draftView";
import { type Answer, checkMessageLimits, ownedDraft, replayOf, viewOf } from "./turn";

export type PhotoUpload = {
  readonly revision: number;
  readonly turnKey: string;
  readonly bytes: Uint8Array;
  readonly device: DeviceFix | null;
  // The page's own offset from UTC, for a camera time written with none. Absent with no script.
  readonly offsetMinutes: number | null;
};

// Where the report says it happened: the GPS reading, else the picked village's centre.
// A draft at the photo step always has its place.
async function placePoint(bindings: ServiceBindings, draft: DraftRecord): Promise<Point | null> {
  const value = ((draft.content as DraftContent).states.place as { value: PlaceValue }).value;
  return value.point ?? villageCentre(bindings.db, value.snapshotId, value.villageCode);
}

const refused = async (
  bindings: ServiceBindings,
  draft: DraftRecord,
  rule: string,
  turnKey: string,
): Promise<Answer> => ({
  kind: "invalid",
  code: "request.invalidFields",
  errors: [{ fieldId: "photo", rule: `photo.${rule}`, params: {} }],
  draft: await viewOf(bindings, draft, [], turnKey),
});

// One photo in the photo step. The checks read the photo's own data, then its metadata is stripped
// and the file stored before its row; a row that does not land takes its file with it.
export async function addPhoto(
  bindings: ServiceBindings,
  principal: Principal,
  address: string,
  draftId: string,
  upload: PhotoUpload,
  requestHash: string,
): Promise<Answer> {
  const owned = await ownedDraft(bindings, principal, draftId);
  if (owned.kind !== "owned") return owned;
  const { draft } = owned;
  const stored = await storedReply(bindings.db, draft.id, upload.turnKey);
  if (stored) return replayOf(stored, requestHash);
  const refusal = await checkMessageLimits(bindings, principal, address, draft);
  if (refusal) return { kind: "limit", refusal, draft: await viewOf(bindings, draft, [], upload.turnKey) };
  if (draft.state !== "photos") return refused(bindings, draft, "notNow", upload.turnKey);
  if (upload.revision !== draft.revision)
    return { kind: "changed", draft: await viewOf(bindings, draft, [], upload.turnKey) };
  const nowMs = bindings.clock.now();
  const zone = draftZone(draft.villageCode);
  const kept = await draftPhotos(bindings.db, draft.id);
  const checked = checkPhoto({
    bytes: upload.bytes,
    exif: readExif(upload.bytes),
    nowMs,
    device: upload.device,
    placePoint: await placePoint(bindings, draft),
    count: kept.length,
    fallbackOffsetMinutes: upload.offsetMinutes ?? zoneOffsetMs(zone) / MINUTE_MS,
  });
  if (checked.kind === "refused") return refused(bindings, draft, checked.rule, upload.turnKey);
  if (kept.length >= photoMax(draft.content as DraftContent))
    return refused(bindings, draft, "tooMany", upload.turnKey);
  const clean = stripJpeg(upload.bytes);
  if (clean === null) return refused(bindings, draft, "broken", upload.turnKey);
  const id = crypto.randomUUID();
  const storeKey = `photos/${draft.id}/${id}.jpg`;
  await bindings.photos.put(storeKey, clean);
  const at = new Date(nowMs);
  const after = { ...draft, revision: draft.revision + 1, lastActedAt: at };
  const photos = [
    ...(await draftPhotos(bindings.db, draft.id)),
    { ...checked, id, storeKey, receivedAt: at, version: 1 },
  ];
  const body = await viewOf(bindings, after, [], upload.turnKey, photos);
  const done = await atomically(bindings.db, [
    photoAdded(draft.id, draft.revision, at),
    changedOne,
    insertPhoto(draft.id, { ...checked, id, storeKey, bytes: clean.length }, at),
    storeReply(draft.id, upload.turnKey, { requestHash, status: 200, body }, at),
  ]);
  if (done === null) {
    await bindings.photos.delete([storeKey]);
    const again = await storedReply(bindings.db, draft.id, upload.turnKey);
    if (again) return replayOf(again, requestHash);
    const fresh = (await loadDraft(bindings.db, draft.id)) as DraftRecord;
    return { kind: "changed", draft: await viewOf(bindings, fresh, [], upload.turnKey) };
  }
  return { kind: "ok", status: 200, body };
}

export type PhotoFile = { readonly kind: "file"; readonly bytes: Uint8Array } | { readonly kind: "notFound" };

// A photo file for the draft's owner only. Anyone else, and a file that is gone, is told it does not exist.
export async function readPhoto(
  bindings: ServiceBindings,
  principal: Principal,
  draftId: string,
  photoId: string,
): Promise<PhotoFile> {
  const owned = await ownedDraft(bindings, principal, draftId);
  if (owned.kind !== "owned") return { kind: "notFound" };
  const photo = await photoOf(bindings.db, draftId, photoId);
  const bytes = photo ? await bindings.photos.get(photo.storeKey) : null;
  return bytes ? { kind: "file", bytes } : { kind: "notFound" };
}
