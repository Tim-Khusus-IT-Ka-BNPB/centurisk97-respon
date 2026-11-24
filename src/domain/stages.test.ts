import { describe, expect, test } from "vitest";
import { stagesOf } from "./stages";

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
    expect(stagesOf([])[0]).toEqual({ status: "new", reachedAtMs: null });
  });
});
