import { deskReport } from "../adapters/d1/desk";
import {
  draftVideos,
  dropUpload,
  type KeptVideo,
  keepPart,
  keepVideo,
  openUpload,
  openUploads,
  removeVideo,
  reportVideo,
  staleUploads,
  type UploadRow,
  uploadOf,
} from "../adapters/d1/videos";
import { HOUR_MS } from "../domain/time";
import { checkVideo, partBytes, partsOf, VIDEO, type VideoRefusal } from "../domain/video";
import type { Principal, StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { admitted } from "./desk";
import type { LimitRefusal } from "./limits";
import { ownedDraft } from "./turn";

// How each container is served to the desk.
const CONTENT_TYPE: Readonly<Record<string, string>> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export type Progress = {
  readonly id: string;
  readonly parts: number;
  readonly partBytes: number;
  readonly received: number[];
};

export type VideoAnswer<T> =
  | { readonly kind: "ok"; readonly body: T }
  | { readonly kind: "notFound" }
  | { readonly kind: "expired" }
  // Why the video is refused, as a rule on the video field.
  | { readonly kind: "refused"; readonly rule: string };

const progressOf = (upload: UploadRow): Progress => ({
  id: upload.id,
  parts: partsOf(upload.bytes),
  partBytes: VIDEO.partBytes,
  received: Object.keys(JSON.parse(upload.parts) as Record<string, string>)
    .map(Number)
    .sort((a, b) => a - b),
});

// The draft, open at its photo step, for its owner.
async function photoStep(bindings: ServiceBindings, principal: Principal, draftId: string) {
  const owned = await ownedDraft(bindings, principal, draftId);
  if (owned.kind !== "owned") return owned;
  if (owned.draft.state !== "photos") return { kind: "refused", rule: "video.notNow" } as const;
  return owned;
}

// A video announced by its size: an upload opens, and the parts it wants are named.
// Bounded by the draft: two open at once and three kept, so no message limit counts it.
export async function startVideo(
  bindings: ServiceBindings,
  principal: Principal,
  draftId: string,
  video: { readonly bytes: number; readonly seconds: number | null },
): Promise<VideoAnswer<Progress>> {
  const step = await photoStep(bindings, principal, draftId);
  if (step.kind !== "owned") return step;
  if (video.bytes < VIDEO.minBytes || video.bytes > VIDEO.maxBytes) return { kind: "refused", rule: "video.tooBig" };
  if (video.seconds !== null && video.seconds > VIDEO.maxSeconds + 1) return { kind: "refused", rule: "video.tooLong" };
  if ((await draftVideos(bindings.db, draftId)).length >= VIDEO.perReport)
    return { kind: "refused", rule: "video.tooMany" };
  if ((await openUploads(bindings.db, draftId)) >= VIDEO.openUploads) return { kind: "refused", rule: "video.busy" };
  const id = crypto.randomUUID();
  const storeKey = `videos/${draftId}/${id}`;
  const uploadId = await bindings.photos.startUpload(storeKey, "application/octet-stream");
  const upload = {
    id,
    draft_id: draftId,
    store_key: storeKey,
    upload_id: uploadId,
    bytes: video.bytes,
    browser_seconds: video.seconds,
  };
  await openUpload(bindings.db, { ...upload, at: new Date(bindings.clock.now()) });
  return { kind: "ok", body: progressOf({ ...upload, parts: "{}" }) };
}

// The upload of this draft, for its owner.
async function ownUpload(bindings: ServiceBindings, principal: Principal, draftId: string, id: string) {
  const owned = await ownedDraft(bindings, principal, draftId);
  if (owned.kind !== "owned") return owned;
  const upload = await uploadOf(bindings.db, draftId, id);
  return upload === null ? ({ kind: "notFound" } as const) : ({ kind: "upload", upload } as const);
}

// Which parts have landed, so a broken send continues where it stopped.
export async function videoProgress(
  bindings: ServiceBindings,
  principal: Principal,
  draftId: string,
  id: string,
): Promise<VideoAnswer<Progress>> {
  const found = await ownUpload(bindings, principal, draftId, id);
  return found.kind === "upload" ? { kind: "ok", body: progressOf(found.upload) } : found;
}

// One part, of exactly its size; sent again, it takes the place of the one before.
export async function putVideoPart(
  bindings: ServiceBindings,
  principal: Principal,
  draftId: string,
  id: string,
  n: number,
  bytes: Uint8Array,
): Promise<VideoAnswer<Progress>> {
  const found = await ownUpload(bindings, principal, draftId, id);
  if (found.kind !== "upload") return found;
  const { upload } = found;
  if (n >= partsOf(upload.bytes)) return { kind: "notFound" };
  if (bytes.length !== partBytes(upload.bytes, n)) return { kind: "refused", rule: "video.partCut" };
  const etag = await bindings.photos.uploadPart(upload.store_key, upload.upload_id, n + 1, bytes);
  const parts = await keepPart(bindings.db, id, n, etag, new Date(bindings.clock.now()));
  return { kind: "ok", body: progressOf({ ...upload, parts }) };
}

// Every part in: the file is made whole, read by its own bytes, and joins the draft. A video
// refused leaves nothing behind.
export async function completeVideo(
  bindings: ServiceBindings,
  principal: Principal,
  draftId: string,
  id: string,
): Promise<VideoAnswer<readonly KeptVideo[]>> {
  const found = await ownUpload(bindings, principal, draftId, id);
  if (found.kind !== "upload") return found;
  const { upload } = found;
  const progress = progressOf(upload);
  if (progress.received.length !== progress.parts) return { kind: "refused", rule: "video.partsMissing" };
  const parts = Object.entries(JSON.parse(upload.parts) as Record<string, string>).map(([n, etag]) => ({
    partNumber: Number(n) + 1,
    etag,
  }));
  const drop = async (rule: VideoRefusal | "tooMany" | "notNow", whole: boolean) => {
    if (whole) await bindings.photos.delete([upload.store_key]);
    else await bindings.photos.abortUpload(upload.store_key, upload.upload_id);
    await dropUpload(bindings.db, id);
    return { kind: "refused", rule: `video.${rule}` } as const;
  };
  const step = await photoStep(bindings, principal, draftId);
  if (step.kind !== "owned") return drop("notNow", false);
  await bindings.photos.completeUpload(
    upload.store_key,
    upload.upload_id,
    parts.sort((a, b) => a.partNumber - b.partNumber),
  );
  // Just made whole, so it is there.
  const read = async (offset: number) =>
    (await bindings.photos.range(upload.store_key, offset, VIDEO.sideBytes)) as { bytes: Uint8Array; size: number };
  const head = await read(0);
  const size = head.size;
  const tail = size > VIDEO.sideBytes ? (await read(Math.max(VIDEO.sideBytes, size - VIDEO.sideBytes))).bytes : null;
  const checked = checkVideo({
    head: head.bytes,
    tail,
    bytes: size,
    announcedBytes: upload.bytes,
    browserSeconds: upload.browser_seconds,
  });
  if (checked.kind !== "ok") return drop(checked.kind, true);
  if ((await draftVideos(bindings.db, draftId)).length >= VIDEO.perReport) return drop("tooMany", true);
  await keepVideo(
    bindings.db,
    { id, draftId, storeKey: upload.store_key, bytes: size, container: checked.container, seconds: checked.seconds },
    new Date(bindings.clock.now()),
  );
  await dropUpload(bindings.db, id);
  return { kind: "ok", body: await draftVideos(bindings.db, draftId) };
}

export async function listVideos(
  bindings: ServiceBindings,
  principal: Principal,
  draftId: string,
): Promise<VideoAnswer<readonly KeptVideo[]>> {
  const owned = await ownedDraft(bindings, principal, draftId);
  return owned.kind === "owned" ? { kind: "ok", body: await draftVideos(bindings.db, draftId) } : owned;
}

// A video taken back before the report is sent; its file follows through the removal queue.
export async function takeBackVideo(
  bindings: ServiceBindings,
  principal: Principal,
  draftId: string,
  id: string,
): Promise<VideoAnswer<readonly KeptVideo[]>> {
  const step = await photoStep(bindings, principal, draftId);
  if (step.kind !== "owned") return step;
  // Its file is queued by a trigger, which the count of changes includes.
  return (await removeVideo(bindings.db, draftId, id)) > 0
    ? { kind: "ok", body: await draftVideos(bindings.db, draftId) }
    : { kind: "notFound" };
}

// The sweep: uploads with no new part for a day are given up, store and row (D90).
export async function sweepVideoUploads(bindings: Pick<ServiceBindings, "db" | "photos" | "clock">, limit = 20) {
  const stale = await staleUploads(bindings.db, new Date(bindings.clock.now() - 24 * HOUR_MS), limit);
  for (const upload of stale) {
    await bindings.photos.abortUpload(upload.store_key, upload.upload_id).catch(() => undefined);
    await dropUpload(bindings.db, upload.id);
  }
  return stale.length;
}

export type DeskVideo =
  | { readonly kind: "file"; readonly bytes: Uint8Array; readonly contentType: string }
  | { readonly kind: "notFound" | "notAllowed" }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// A report's video for an officer who may read the report, in its region.
export async function deskVideo(
  bindings: ServiceBindings,
  staff: StaffPrincipal,
  ticketNumber: string,
  id: string,
): Promise<DeskVideo> {
  const refused = await admitted(bindings, staff, "readReport", "desk.read");
  if (refused) return refused;
  if ((await deskReport(bindings.db, staff.scope, ticketNumber)) === null) return { kind: "notFound" };
  const video = await reportVideo(bindings.db, ticketNumber, id);
  const bytes = video === null ? null : await bindings.photos.get(video.store_key);
  return video === null || bytes === null
    ? { kind: "notFound" }
    : { kind: "file", bytes, contentType: CONTENT_TYPE[video.container] as string };
}
