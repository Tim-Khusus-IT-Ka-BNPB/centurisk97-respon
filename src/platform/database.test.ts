import { describe, expect, test } from "vitest";
import { testDatabase } from "../testing/api";
import { row, sql } from "./database";

describe("values bound to a statement", () => {
  test("an instant is ISO text, a boolean 1 or 0, an object JSON, and nothing missing is null", async () => {
    const bound = await row(
      testDatabase(),
      sql`select ${new Date("2026-11-23T03:00:00.000Z")} as instant, ${true} as yes, ${false} as no,
        ${{ a: [1] }} as object, ${undefined} as missing, ${sql`'inlined'`} as fragment`,
    );
    expect(bound).toEqual({
      instant: "2026-11-23T03:00:00.000Z",
      yes: 1,
      no: 0,
      object: '{"a":[1]}',
      missing: null,
      fragment: "inlined",
    });
  });
});
