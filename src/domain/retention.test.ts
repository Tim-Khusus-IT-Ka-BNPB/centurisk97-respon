import { describe, expect, test } from "vitest";
import { RETENTION, sweepCutoffs } from "./retention";

describe("retention", () => {
  test("each kind of row has its keep time and the sweep works in batches of 500", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(RETENTION).toEqual({
      draftLifeMs: day,
      turnReplyMs: day,
      rateCounterMs: 2 * day,
      modelUsageDays: 2,
      deviceUnseenMs: 365 * day,
      emptiedDraftMs: 30 * day,
      batch: 500,
    });
  });

  test("the cutoffs of a run, with model usage kept for today and yesterday in WIB", () => {
    // 2026-11-24 01:00 WIB.
    const cutoffs = sweepCutoffs(Date.parse("2026-11-23T18:00:00.000Z"));
    expect(cutoffs).toEqual({
      draftActedBefore: new Date("2026-11-22T18:00:00.000Z"),
      turnReplyBefore: new Date("2026-11-22T18:00:00.000Z"),
      rateWindowBefore: new Date("2026-11-21T18:00:00.000Z"),
      modelUsageBefore: "2026-11-23",
      deviceSeenBefore: new Date("2025-11-23T18:00:00.000Z"),
      draftEndedBefore: new Date("2026-10-24T18:00:00.000Z"),
    });
  });
});
