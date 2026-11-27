import { anonymiseMissing } from "../adapters/d1/missingPersons";
import { clearRemovals, queuedRemovals } from "../adapters/d1/photos";
import { expireBatch, pruneBatch, removeDeviceBatch, removeEmptiedBatch } from "../adapters/d1/sweep";
import { MISSING_KEPT_MS } from "../domain/missingPerson";
import { RETENTION, sweepCutoffs } from "../domain/retention";
import type { Database } from "../platform/database";
import type { Logger } from "../platform/log";
import type { Clock } from "../ports/clock";
import type { PhotoStore } from "../ports/photoStore";
import { erasePersonalData } from "./cases";
import { sweepVideoUploads } from "./videos";

export type SweepCounts = {
  readonly expired: number;
  readonly pruned: number;
  readonly devicesRemoved: number;
  readonly draftsRemoved: number;
  readonly missingAnonymised: number;
  readonly photoFilesRemoved: number;
  readonly videoUploadsDropped: number;
  // BPBD follow-up files whose personal data ended five years after their closing was accepted.
  readonly caseFilesErased: number;
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
// anonymise missing persons closed two years ago, then delete the files of photos that left with
// their drafts or reports.
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
    missingAnonymised: await drain(() =>
      anonymiseMissing(db, new Date(nowMs - MISSING_KEPT_MS), new Date(nowMs), RETENTION.batch),
    ),
    photoFilesRemoved: await drain(() => removePhotoFiles(db, photos, RETENTION.batch)),
    videoUploadsDropped: await sweepVideoUploads({ db, photos, clock }),
    caseFilesErased: await erasePersonalData({ db, photos, clock }),
  };
  log.info({ event: "sweep.done", durationMs: Date.now() - started });
  return counts;
}
