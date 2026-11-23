import { expireBatch, pruneBatch, removeDeviceBatch, removeEmptiedBatch } from "../adapters/d1/sweep";
import { RETENTION, sweepCutoffs } from "../domain/retention";
import type { Database } from "../platform/database";
import type { Logger } from "../platform/log";
import type { Clock } from "../ports/clock";

export type SweepCounts = {
  readonly expired: number;
  readonly pruned: number;
  readonly devicesRemoved: number;
  readonly draftsRemoved: number;
};

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
// prune stored replies, counters and model usage, then remove old devices and emptied drafts.
// Safe to run again at any time: each step only touches rows that are still due.
export async function runSweep(db: Database, clock: Clock, log: Logger): Promise<SweepCounts> {
  const started = Date.now();
  const nowMs = clock.now();
  const cutoffs = sweepCutoffs(nowMs);
  const counts = {
    expired: await drain(() => expireBatch(db, cutoffs, new Date(nowMs), RETENTION.batch)),
    pruned: await drain(() => pruneBatch(db, cutoffs, RETENTION.batch)),
    devicesRemoved: await drain(() => removeDeviceBatch(db, cutoffs, RETENTION.batch)),
    draftsRemoved: await drain(() => removeEmptiedBatch(db, cutoffs, RETENTION.batch)),
  };
  log.info({ event: "sweep.done", durationMs: Date.now() - started });
  return counts;
}
