import { describe, expect, test } from "vitest";
import { type HistoryNews, isUnread, reporterNews } from "./reporterNews";

const row = (more: Partial<HistoryNews> = {}): HistoryNews => ({
  actor: "staff",
  event: null,
  fromStatus: "seen",
  toStatus: "under_review",
  note: "Catatan petugas",
  actions: [],
  atMs: 10,
  ...more,
});

describe("what a reporter is told", () => {
  test("each move of the ticket by staff, with no note but the reason it was set aside", () => {
    expect(reporterNews([row()], [], [])).toEqual([{ kind: "status", atMs: 10, status: "under_review", reason: null }]);
    expect(reporterNews([row({ toStatus: "invalid", note: "Laporan ganda" })], [], [])).toEqual([
      { kind: "status", atMs: 10, status: "invalid", reason: "Laporan ganda" },
    ]);
    // A check on site that found nothing sets it aside too.
    expect(reporterNews([row({ event: "fieldCheck", toStatus: "invalid", note: "Tidak ada" })], [], [])).toEqual([
      { kind: "status", atMs: 10, status: "invalid", reason: "Tidak ada" },
    ]);
  });

  test("what was done, replies and corrections", () => {
    expect(
      reporterNews(
        [row({ event: "actions", fromStatus: "in_handling", toStatus: "in_handling", actions: ["Evakuasi"], atMs: 1 })],
        [{ text: "Terima kasih", atMs: 3 }],
        [{ version: 2, atMs: 2 }],
      ),
    ).toEqual([
      { kind: "reply", text: "Terima kasih", atMs: 3 },
      { kind: "correction", version: 2, atMs: 2 },
      { kind: "actions", actions: ["Evakuasi"], atMs: 1 },
    ]);
  });

  test("not what the system or the reporter did, a check that moved nothing, or who took the report", () => {
    expect(
      reporterNews(
        [
          row({ actor: "system", fromStatus: null, toStatus: "new" }),
          row({ actor: "reporter", event: "followUp", fromStatus: "seen", toStatus: "seen" }),
          row({ event: "fieldCheck", fromStatus: "seen", toStatus: "seen" }),
          row({ event: "take", fromStatus: "seen", toStatus: "under_review" }),
        ],
        [],
        [],
      ),
    ).toEqual([]);
  });

  test("the newest first; of one moment, the last done first", () => {
    const told = reporterNews(
      [
        row({ atMs: 5, toStatus: "seen", fromStatus: "new" }),
        row({ atMs: 5 }),
        row({ atMs: 9, toStatus: "forwarded" }),
      ],
      [{ text: "Balasan", atMs: 5 }],
      [],
    );
    expect(told.map((item) => (item.kind === "status" ? item.status : item.kind))).toEqual([
      "forwarded",
      "reply",
      "under_review",
      "seen",
    ]);
  });
});

describe("news not read yet", () => {
  test("is later than the last reading, or all of it when never read", () => {
    expect(isUnread(0, null, false)).toBe(true);
    expect(isUnread(10, 9, false)).toBe(true);
    expect(isUnread(10, 10, false)).toBe(false);
    expect(isUnread(10, 11, false)).toBe(false);
  });

  test("is none while the reporter stopped it", () => {
    expect(isUnread(10, null, true)).toBe(false);
    expect(isUnread(10, 9, true)).toBe(false);
  });
});
