import type { KeptPhoto } from "../../domain/photoChecks";
import { type Database, type Query, row, rows, sql } from "../../platform/database";

export type PhotoRecord = KeptPhoto & { readonly id: string; readonly storeKey: string; readonly receivedAt: Date };

type PhotoRow = {
  id: string;
  store_key: string;
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  badge: KeptPhoto["badge"];
  far: number;
  taken_at: string;
  time_source: KeptPhoto["timeSource"];
  received_at: string;
};

const recordOf = (one: PhotoRow): PhotoRecord => ({
  id: one.id,
  storeKey: one.store_key,
  badge: one.badge,
  point: one.lat === null || one.lon === null ? null : { lat: one.lat, lon: one.lon },
  accuracyM: one.accuracy_m,
  takenAtMs: Date.parse(one.taken_at),
  timeSource: one.time_source,
  far: one.far === 1,
  receivedAt: new Date(one.received_at),
});

const COLUMNS = sql`id, store_key, lat, lon, accuracy_m, badge, far, taken_at, time_source, received_at`;

// The photos of a draft in the order they arrived.
export async function draftPhotos(db: Database, draftId: string): Promise<PhotoRecord[]> {
  const found = await rows<PhotoRow>(
    db,
    sql`select ${COLUMNS} from draft_photo where draft_id = ${draftId} order by received_at, id`,
  );
  return found.map(recordOf);
}

export async function photoOf(db: Database, draftId: string, photoId: string): Promise<PhotoRecord | null> {
  const found = await row<PhotoRow>(
    db,
    sql`select ${COLUMNS} from draft_photo where draft_id = ${draftId} and id = ${photoId}`,
  );
  return found ? recordOf(found) : null;
}

export const insertPhoto = (
  draftId: string,
  photo: KeptPhoto & { readonly id: string; readonly storeKey: string; readonly bytes: number },
  at: Date,
): Query =>
  sql`insert into draft_photo (id, draft_id, store_key, bytes, lat, lon, accuracy_m, badge, far, taken_at, time_source,
      received_at)
    values (${photo.id}, ${draftId}, ${photo.storeKey}, ${photo.bytes}, ${photo.point?.lat ?? null},
      ${photo.point?.lon ?? null}, ${photo.accuracyM}, ${photo.badge}, ${photo.far ? 1 : 0},
      ${new Date(photo.takenAtMs)}, ${photo.timeSource}, ${at})`;

// Files whose rows are gone, oldest first.
export async function queuedRemovals(db: Database, batch: number): Promise<string[]> {
  const found = await rows<{ store_key: string }>(
    db,
    sql`select store_key from photo_removal order by queued_at, store_key limit ${batch}`,
  );
  return found.map((one) => one.store_key);
}

export async function clearRemovals(db: Database, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const list = keys.slice(1).reduce((fragment, key) => sql`${fragment}, ${key}`, sql`${keys[0]}`);
  await rows(db, sql`delete from photo_removal where store_key in (${list})`);
}
