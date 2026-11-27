import {
  type CaseUploadRow,
  caseUploadOf,
  dropCaseUpload,
  keepCasePart,
  keepCaseVideo,
  openCaseUpload,
  openCaseUploads,
  recordVideos,
  removeCaseVideo,
  staleCaseUploads,
} from "../adapters/d1/cases";
import { HOUR_MS } from "../domain/time";
import { checkVideo, partBytes, partsOf, VIDEO, type VideoRefusal } from "../domain/video";
import type { ServiceBindings } from "./bindings";
import { type CaseActor, caseRecordFor } from "./cases";
import type { LimitRefusal } from "./limits";

// A video of a house or a piece of infrastructure (upstream LJ-18, video optional per K5), sent in
// parts like a report's own: a broken send goes on where it stopped.

// As many as a report takes, so the uploader says one limit.
const PER_RECORD = VIDEO.perReport;
const MADE_SINCE_MS = Date.UTC(2010, 0, 1);
const WITH_VIDEO = new Set(["house", "infrastructure"]);

export type CaseProgress = {
  readonly id: string;
  readonly parts: number;
  readonly partBytes: number;
  readonly received: number[];
};
export type KeptVideo = { readonly id: string; readonly seconds: number; readonly container: string };
export type CaseVideoAnswer<T> =
  | { readonly kind: "ok"; readonly body: T }
  | { readonly kind: "notFound" }
  | { readonly kind: "closed" }
  | { readonly kind: "notAllowed" }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal }
  | { readonly kind: "refused"; readonly rule: string };

const progressOf = (upload: CaseUploadRow): CaseProgress => ({
  id: upload.id,
  parts: partsOf(upload.bytes),
  partBytes: VIDEO.partBytes,
  received: Object.keys(JSON.parse(upload.parts) as Record<string, string>)
    .map(Number)
    .sort((a, b) => a - b),
});

const kept = async (bindings: ServiceBindings, recordId: string): Promise<KeptVideo[]> =>
  (await recordVideos(bindings.db, recordId)).map(({ id, seconds, container }) => ({ id, seconds, container }));

// The record, kept, in a file this actor may fill, of a kind that takes a video.
async function videoRecord(bindings: ServiceBindings, actor: CaseActor, fileId: string, recordId: string) {
  const found = await caseRecordFor(bindings, actor, fileId, recordId);
  if (found.kind !== "record") return found;
  return WITH_VIDEO.has(found.record.kind) ? found : ({ kind: "refused", rule: "video.notNow" } as const);
}

export async function caseVideos(
  bindings: ServiceBindings,
  actor: CaseActor,
  fileId: string,
  recordId: string,
): Promise<CaseVideoAnswer<KeptVideo[]>> {
  const found = await videoRecord(bindings, actor, fileId, recordId);
  return found.kind === "record" ? { kind: "ok", body: await kept(bindings, recordId) } : found;
}

// A video announced by its size: an upload opens and the parts it wants are named.
export async function startCaseVideo(
  bindings: ServiceBindings,
  actor: CaseActor,
  fileId: string,
  recordId: string,
  video: { readonly bytes: number; readonly seconds: number | null },
): Promise<CaseVideoAnswer<CaseProgress>> {
  const found = await videoRecord(bindings, actor, fileId, recordId);
  if (found.kind !== "record") return found;
  if (video.bytes < VIDEO.minBytes || video.bytes > VIDEO.maxBytes) return { kind: "refused", rule: "video.tooBig" };
  if (video.seconds !== null && video.seconds > VIDEO.maxSeconds + 1) return { kind: "refused", rule: "video.tooLong" };
  if ((await kept(bindings, recordId)).length >= PER_RECORD) return { kind: "refused", rule: "video.tooMany" };
  if ((await openCaseUploads(bindings.db, recordId)) >= VIDEO.openUploads)
    return { kind: "refused", rule: "video.busy" };
  const id = crypto.randomUUID();
  const storeKey = `cases/${fileId}/${id}`;
  const uploadId = await bindings.photos.startUpload(storeKey, "application/octet-stream");
  const upload = { id, store_key: storeKey, upload_id: uploadId, bytes: video.bytes, browser_seconds: video.seconds };
  await openCaseUpload(bindings.db, { ...upload, fileId, recordId }, new Date(bindings.clock.now()));
  return { kind: "ok", body: progressOf({ ...upload, parts: "{}" }) };
}

async function ownUpload(bindings: ServiceBindings, actor: CaseActor, fileId: string, recordId: string, id: string) {
  const found = await videoRecord(bindings, actor, fileId, recordId);
  if (found.kind !== "record") return found;
  const upload = await caseUploadOf(bindings.db, recordId, id);
  return upload === null ? ({ kind: "notFound" } as const) : ({ kind: "upload", upload, by: found.by } as const);
}

export async function caseVideoProgress(
  bindings: ServiceBindings,
  actor: CaseActor,
  fileId: string,
  recordId: string,
  id: string,
): Promise<CaseVideoAnswer<CaseProgress>> {
  const found = await ownUpload(bindings, actor, fileId, recordId, id);
  return found.kind === "upload" ? { kind: "ok", body: progressOf(found.upload) } : found;
}

// One part, of exactly its size; sent again, it takes the place of the one before.
export async function putCaseVideoPart(
  bindings: ServiceBindings,
  actor: CaseActor,
  fileId: string,
  recordId: string,
  id: string,
  part: { readonly n: number; readonly bytes: Uint8Array },
): Promise<CaseVideoAnswer<CaseProgress>> {
  const found = await ownUpload(bindings, actor, fileId, recordId, id);
  if (found.kind !== "upload") return found;
  const { upload } = found;
  if (part.n >= partsOf(upload.bytes)) return { kind: "notFound" };
  if (part.bytes.length !== partBytes(upload.bytes, part.n)) return { kind: "refused", rule: "video.partCut" };
  const etag = await bindings.photos.uploadPart(upload.store_key, upload.upload_id, part.n + 1, part.bytes);
  const parts = await keepCasePart(bindings.db, id, part.n, etag, new Date(bindings.clock.now()));
  return { kind: "ok", body: progressOf({ ...upload, parts }) };
}

// Every part in: made whole, read by its own bytes, and kept with the record. A video refused
// leaves nothing behind.
export async function completeCaseVideo(
  bindings: ServiceBindings,
  actor: CaseActor,
  fileId: string,
  recordId: string,
  id: string,
): Promise<CaseVideoAnswer<KeptVideo[]>> {
  const found = await ownUpload(bindings, actor, fileId, recordId, id);
  if (found.kind !== "upload") return found;
  const { upload } = found;
  const progress = progressOf(upload);
  if (progress.received.length !== progress.parts) return { kind: "refused", rule: "video.partsMissing" };
  const parts = Object.entries(JSON.parse(upload.parts) as Record<string, string>).map(([n, etag]) => ({
    partNumber: Number(n) + 1,
    etag,
  }));
  await bindings.photos.completeUpload(
    upload.store_key,
    upload.upload_id,
    parts.sort((a, b) => a.partNumber - b.partNumber),
  );
  const drop = async (rule: VideoRefusal | "tooMany") => {
    await bindings.photos.delete([upload.store_key]);
    await dropCaseUpload(bindings.db, id);
    return { kind: "refused", rule: `video.${rule}` } as const;
  };
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
  if (checked.kind !== "ok") return drop(checked.kind);
  const nowMs = bindings.clock.now();
  const made =
    checked.createdMs !== null && checked.createdMs > MADE_SINCE_MS && checked.createdMs <= nowMs + 5 * 60_000;
  const keptNow = await keepCaseVideo(
    bindings.db,
    {
      id,
      fileId,
      recordId,
      objectKey: upload.store_key,
      seconds: checked.seconds,
      container: checked.container,
      madeAt: made ? new Date(checked.createdMs as number) : null,
      point: checked.point,
      by: found.by,
    },
    PER_RECORD,
    new Date(nowMs),
  );
  if (!keptNow) return drop("tooMany");
  return { kind: "ok", body: await kept(bindings, recordId) };
}

// A video taken back: its file goes, and the record's list is answered as it is now.
export async function takeBackCaseVideo(
  bindings: ServiceBindings,
  actor: CaseActor,
  fileId: string,
  recordId: string,
  id: string,
): Promise<CaseVideoAnswer<KeptVideo[]>> {
  const found = await videoRecord(bindings, actor, fileId, recordId);
  if (found.kind !== "record") return found;
  const video = (await recordVideos(bindings.db, recordId)).find((one) => one.id === id);
  if (video === undefined) return { kind: "notFound" };
  await removeCaseVideo(bindings.db, { fileId, recordId, id, by: found.by }, new Date(bindings.clock.now()));
  await bindings.photos.delete([video.object_key]);
  return { kind: "ok", body: await kept(bindings, recordId) };
}

// Uploads untouched for a day are given up, their parts dropped.
export async function sweepCaseVideoUploads(bindings: Pick<ServiceBindings, "db" | "photos" | "clock">, limit = 20) {
  const stale = await staleCaseUploads(bindings.db, new Date(bindings.clock.now() - 24 * HOUR_MS), limit);
  for (const upload of stale) {
    await bindings.photos.abortUpload(upload.store_key, upload.upload_id).catch(() => undefined);
    await dropCaseUpload(bindings.db, upload.id);
  }
  return stale.length;
}
