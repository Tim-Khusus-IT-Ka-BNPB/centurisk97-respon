import { clearRemovals, queuedRemovals } from "../adapters/d1/photos";
import { expireBatch, pruneBatch, removeDeviceBatch, removeEmptiedBatch } from "../adapters/d1/sweep";
import { RETENTION, sweepCutoffs } from "../domain/retention";
import type { Database } from "../platform/database";
import type { Logger } from "../platform/log";
import type { Clock } from "../ports/clock";
import type { PhotoStore } from "../ports/photoStore";

export type SweepCounts = {
  readonly expired: number;
  readonly pruned: number;
  readonly devicesRemoved: number;
  readonly draftsRemoved: number;
  readonly photoFilesRemoved: number;
};

// Deletes the files of photos whose rows are gone, then their queue rows. A run that stops in
// between deletes the same files again next time, which the store allows.
async function removePhotoFiles(db: Database, photos: PhotoStore, batch: number): Promise<number> {
  const keys = await queuedRemovals(db, batch);
  await photos.delete(keys);
  await clearRemovals(db, keys);
  return keys.length;
}

// Runs one step batch by batch until a batch comes back short.
async function drain(step: () => Promise<number>): Promise<number> {
  let total = 0;
  for (;;) {
    const done = await step();
    total += done;
    if (done < RETENTION.batch) return total;
  }
}

// The scheduled run, every 15 minutes: expire drafts 24 hours after the reporter last acted,
// prune stored replies, counters and model usage, remove old devices and emptied drafts, then
// delete the files of photos that left with their drafts.
// Safe to run again at any time: each step only touches rows that are still due.
export async function runSweep(db: Database, photos: PhotoStore, clock: Clock, log: Logger): Promise<SweepCounts> {
  const started = Date.now();
  const nowMs = clock.now();
  const cutoffs = sweepCutoffs(nowMs);
  const counts = {
    expired: await drain(() => expireBatch(db, cutoffs, new Date(nowMs), RETENTION.batch)),
    pruned: await drain(() => pruneBatch(db, cutoffs, RETENTION.batch)),
    devicesRemoved: await drain(() => removeDeviceBatch(db, cutoffs, RETENTION.batch)),
    draftsRemoved: await drain(() => removeEmptiedBatch(db, cutoffs, RETENTION.batch)),
    photoFilesRemoved: await drain(() => removePhotoFiles(db, photos, RETENTION.batch)),
  };
  log.info({ event: "sweep.done", durationMs: Date.now() - started });
  return counts;
}
