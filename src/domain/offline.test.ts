import { describe, expect, test } from "vitest";
import { LATE_MS, offlineMark } from "./offline";
import { DAY_MS, MINUTE_MS } from "./time";

const NOW = Date.UTC(2026, 10, 26, 3);

describe("a report kept on a phone with no signal", () => {
  test("late only when the phone's own two times are more than 2 hours apart", () => {
    const saved = NOW - 3 * LATE_MS;
    expect(offlineMark(saved, saved + LATE_MS, NOW)).toEqual({ savedAt: saved, late: false });
    expect(offlineMark(saved, saved + LATE_MS + 1, NOW)).toEqual({ savedAt: saved, late: true });
    // With no send time, or one that cannot be believed, the alarm stays on.
    expect(offlineMark(saved, undefined, NOW)).toEqual({ savedAt: saved, late: false });
    expect(offlineMark(saved, NOW + 5 * MINUTE_MS + 1, NOW)).toEqual({ savedAt: saved, late: false });
  });

  test("a saved time up to 5 minutes ahead and 14 days old is believed, past either it is no note", () => {
    expect(offlineMark(NOW + 5 * MINUTE_MS, undefined, NOW).savedAt).toBe(NOW + 5 * MINUTE_MS);
    expect(offlineMark(NOW - 14 * DAY_MS, undefined, NOW).savedAt).toBe(NOW - 14 * DAY_MS);
    expect(offlineMark(NOW + 5 * MINUTE_MS + 1, NOW, NOW)).toEqual({ savedAt: null, late: false });
    expect(offlineMark(NOW - 14 * DAY_MS - 1, NOW, NOW)).toEqual({ savedAt: null, late: false });
    expect(offlineMark(undefined, NOW, NOW)).toEqual({ savedAt: null, late: false });
  });
});
