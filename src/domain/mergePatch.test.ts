import { describe, expect, test } from "vitest";
import { mergePatch } from "./mergePatch";

describe("a merge patch", () => {
  test("sets values, merges objects into objects, and null clears a key", () => {
    const target = { post: { name: "Posko", phone: "1" }, decree: "SK 1", gone: true, list: [1] };
    expect(mergePatch(target, { post: { phone: "2", note: null }, decree: null, list: [2], added: { a: 1 } })).toEqual({
      post: { name: "Posko", phone: "2" },
      gone: true,
      list: [2],
      added: { a: 1 },
    });
    expect(target.post.phone).toBe("1");
  });

  test("an object over a plain value takes its place", () => {
    expect(mergePatch({ post: "none" }, { post: { name: "Posko" } })).toEqual({ post: { name: "Posko" } });
  });
});
