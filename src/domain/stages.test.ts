import { describe, expect, test } from "vitest";
import { rejectionOf, stagesOf } from "./stages";

describe("stages", () => {
  test("five stages, each done at its first history row; forwarded joins only once it happened", () => {
    expect(stagesOf([{ toStatus: "new", atMs: 10 }])).toEqual([
      { status: "new", reachedAtMs: 10 },
      { status: "seen", reachedAtMs: null },
      { status: "under_review", reachedAtMs: null },
      { status: "in_handling", reachedAtMs: null },
      { status: "closed", reachedAtMs: null },
    ]);
    const handled = stagesOf([
      { toStatus: "forwarded", atMs: 40 },
      { toStatus: "new", atMs: 10 },
      { toStatus: "seen", atMs: 20 },
      { toStatus: "seen", atMs: 30 },
    ]);
    expect(handled.map((stage) => [stage.status, stage.reachedAtMs])).toEqual([
      ["new", 10],
      ["seen", 20],
      ["under_review", null],
      ["forwarded", 40],
      ["in_handling", null],
      ["closed", null],
    ]);
    // History read out of order: the earliest row of a status is its time.
    const late = stagesOf([
      { toStatus: "seen", atMs: 30 },
      { toStatus: "new", atMs: 10 },
      { toStatus: "seen", atMs: 20 },
    ]);
    expect(late[1]).toEqual({ status: "seen", reachedAtMs: 20 });
    expect(stagesOf([])[0]).toEqual({ status: "new", reachedAtMs: null });
  });

  test("a forwarded ticket keeps that stage while it is handled and closed", () => {
    const stages = stagesOf([
      { toStatus: "under_review", atMs: 30 },
      { toStatus: "forwarded", atMs: 40 },
      { toStatus: "in_handling", atMs: 50 },
      { toStatus: "closed", atMs: 60 },
    ]);
    expect(stages.slice(2).map((stage) => stage.reachedAtMs)).toEqual([30, 40, 50, 60]);
  });

  test("a reopened ticket is back at its review, at the time it first got there", () => {
    const history = [
      { toStatus: "new", atMs: 10 },
      { toStatus: "seen", atMs: 20 },
      { toStatus: "under_review", atMs: 30 },
      { toStatus: "forwarded", atMs: 40 },
      { toStatus: "in_handling", atMs: 50 },
      { toStatus: "closed", atMs: 60 },
      { toStatus: "under_review", atMs: 70 },
    ] as const;
    expect(stagesOf(history).map((stage) => [stage.status, stage.reachedAtMs])).toEqual([
      ["new", 10],
      ["seen", 20],
      ["under_review", 30],
      ["in_handling", null],
      ["closed", null],
    ]);
  });

  test("set aside is no stage: what was reached stays reached", () => {
    const stages = stagesOf([
      { toStatus: "new", atMs: 10 },
      { toStatus: "seen", atMs: 20 },
      { toStatus: "invalid", atMs: 30 },
    ]);
    expect(stages.map((stage) => stage.reachedAtMs)).toEqual([10, 20, null, null, null]);
  });
});

describe("a report set aside", () => {
  test("is the latest row when that is where the ticket is; reopened, it is not", () => {
    const seen = { toStatus: "seen", atMs: 20 } as const;
    const aside = { toStatus: "invalid", atMs: 30, note: "Laporan ganda" } as const;
    expect(rejectionOf([aside, seen])).toEqual(aside);
    expect(rejectionOf([seen, aside, { toStatus: "under_review", atMs: 40 }])).toBeNull();
    expect(rejectionOf([seen])).toBeNull();
    expect(rejectionOf([])).toBeNull();
  });
});
