import { type Database, row, rows, run, sql } from "../../platform/database";

export type UploadRow = {
  readonly id: string;
  readonly draft_id: string;
  readonly store_key: string;
  readonly upload_id: string;
  readonly bytes: number;
  readonly parts: string;
  readonly browser_seconds: number | null;
};

export type KeptVideo = { readonly id: string; readonly seconds: number; readonly container: string };

export const uploadOf = (db: Database, draftId: string, id: string) =>
  row<UploadRow>(db, sql`select * from video_upload where id = ${id} and draft_id = ${draftId}`);

// A count always answers one row.
export async function openUploads(db: Database, draftId: string): Promise<number> {
  return ((await row(db, sql`select count(*) as n from video_upload where draft_id = ${draftId}`)) as { n: number }).n;
}

export const openUpload = (db: Database, upload: Omit<UploadRow, "parts"> & { readonly at: Date }) =>
  run(
    db,
    sql`insert into video_upload (id, draft_id, store_key, upload_id, bytes, browser_seconds, started_at, touched_at)
      values (${upload.id}, ${upload.draft_id}, ${upload.store_key}, ${upload.upload_id}, ${upload.bytes},
        ${upload.browser_seconds}, ${upload.at}, ${upload.at})`,
  );

// A part's tag, set in place so two parts landing at once never write over each other. The upload
// was read just before; one ended in between is a fault, answered as one.
export async function keepPart(db: Database, id: string, n: number, etag: string, at: Date): Promise<string> {
  const kept = await row<{ parts: string }>(
    db,
    sql`update video_upload set parts = json_set(parts, ${`$."${n}"`}, ${etag}), touched_at = ${at}
      where id = ${id} returning parts`,
  );
  return (kept as { parts: string }).parts;
}

export const dropUpload = (db: Database, id: string) => run(db, sql`delete from video_upload where id = ${id}`);

export const keepVideo = (
  db: Database,
  video: { id: string; draftId: string; storeKey: string; bytes: number; container: string; seconds: number },
  at: Date,
) =>
  run(
    db,
    sql`insert into draft_video (id, draft_id, store_key, bytes, container, seconds, received_at)
      values (${video.id}, ${video.draftId}, ${video.storeKey}, ${video.bytes}, ${video.container}, ${video.seconds}, ${at})`,
  );

export const draftVideos = (db: Database, draftId: string) =>
  rows<KeptVideo>(
    db,
    sql`select id, seconds, container from draft_video where draft_id = ${draftId} order by received_at, id`,
  );

export const removeVideo = (db: Database, draftId: string, id: string) =>
  run(db, sql`delete from draft_video where draft_id = ${draftId} and id = ${id}`);

// A video of a report, for the desk: its file, by the report's ticket.
export const reportVideo = (db: Database, ticketNumber: string, id: string) =>
  row<{ store_key: string; container: string }>(
    db,
    sql`select v.store_key, v.container from draft_video v join report r on r.draft_id = v.draft_id
      where r.ticket_number = ${ticketNumber} and v.id = ${id}`,
  );

export const reportVideos = (db: Database, ticketNumber: string) =>
  rows<KeptVideo>(
    db,
    sql`select v.id, v.seconds, v.container from draft_video v join report r on r.draft_id = v.draft_id
      where r.ticket_number = ${ticketNumber} order by v.received_at, v.id`,
  );

// Uploads with no new part for a day, for the sweep to give up.
export const staleUploads = (db: Database, before: Date, limit: number) =>
  rows<Pick<UploadRow, "id" | "store_key" | "upload_id">>(
    db,
    sql`select id, store_key, upload_id from video_upload where touched_at < ${before} order by touched_at limit ${limit}`,
  );
