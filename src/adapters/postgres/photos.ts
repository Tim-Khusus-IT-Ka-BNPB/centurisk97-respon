import type { Point } from "../../domain/geo";
import type { GpsDoubt } from "../../domain/gpsDoubts";
import type { KeptPhoto } from "../../domain/photoChecks";
import { type Database, type Query, row, rows, run, sql } from "../../platform/database";

export type PhotoRecord = KeptPhoto & {
  readonly id: string;
  readonly storeKey: string;
  readonly receivedAt: Date;
  // The report's version it came with; 1 until news brings more.
  readonly version: number;
  // Why its GPS may not be where the phone was (D11).
  readonly doubts: readonly GpsDoubt[];
};

type PhotoRow = {
  id: string;
  store_key: string;
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  badge: KeptPhoto["badge"];
  far: boolean;
  taken_at: string;
  time_source: KeptPhoto["timeSource"];
  received_at: string;
  version: number | null;
  gps_doubts: GpsDoubt[] | null;
};

const recordOf = (one: PhotoRow): PhotoRecord => ({
  id: one.id,
  storeKey: one.store_key,
  badge: one.badge,
  point: one.lat === null || one.lon === null ? null : { lat: one.lat, lon: one.lon },
  accuracyM: one.accuracy_m,
  takenAtMs: Date.parse(one.taken_at),
  timeSource: one.time_source,
  far: one.far === true,
  receivedAt: new Date(one.received_at),
  version: one.version ?? 1,
  doubts: one.gps_doubts ?? [],
});

const COLUMNS = sql`id, store_key, lat, lon, accuracy_m, badge, far, taken_at, time_source, received_at, version,
  gps_doubts`;

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
  photo: KeptPhoto & {
    readonly id: string;
    readonly storeKey: string;
    readonly bytes: number;
    readonly doubts: readonly GpsDoubt[];
  },
  at: Date,
): Query =>
  sql`insert into draft_photo (id, draft_id, store_key, bytes, lat, lon, accuracy_m, badge, far, taken_at, time_source,
      received_at, gps_doubts)
    values (${photo.id}, ${draftId}, ${photo.storeKey}, ${photo.bytes}, ${photo.point?.lat ?? null},
      ${photo.point?.lon ?? null}, ${photo.accuracyM}, ${photo.badge}, ${photo.far},
      ${new Date(photo.takenAtMs)}, ${photo.timeSource}, ${at},
      ${photo.doubts.length === 0 ? null : JSON.stringify(photo.doubts)})`;

// Its file is queued to go with its row.
export const deletePhoto = (draftId: string, photoId: string): Query =>
  sql`delete from draft_photo where draft_id = ${draftId} and id = ${photoId}`;

// Photos of the chat kept without a place since then, placed now.
export const placeChatPhotos = (
  db: Database,
  draftId: string,
  place: { readonly badge: KeptPhoto["badge"]; readonly point: Point; readonly far: boolean },
  since: Date,
): Promise<number> =>
  run(
    db,
    sql`update draft_photo set badge = ${place.badge}, lat = ${place.point.lat}, lon = ${place.point.lon}, far = ${place.far}
      where draft_id = ${draftId} and badge = 'none' and time_source = 'chatMessage' and received_at >= ${since}`,
  );

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
