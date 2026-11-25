import { describe, expect, test } from "vitest";
import { firstLines, NEWS_LINES, NEWS_WAITS_MS, type NoticeRow, newsMessages } from "./news";

const row = (id: number, kind: NoticeRow["kind"], more: Partial<NoticeRow> = {}): NoticeRow => ({
  id,
  ticketNumber: "LA-251126-01",
  atMs: 1000,
  kind,
  status: null,
  note: null,
  actions: [],
  reply: null,
  version: null,
  ...more,
});
const message = (id: number, more: object = {}) => ({
  id,
  ticketNumber: "LA-251126-01",
  atMs: 1000,
  status: null,
  actions: [],
  reply: null,
  corrected: null,
  document: null,
  ...more,
});

describe("news as messages", () => {
  test("the things of one act are one message, named by its first notice", () => {
    expect(
      newsMessages([
        row(1, "status", { status: "seen", note: "dilihat" }),
        row(2, "status", { status: "under_review" }),
        row(3, "reply", { reply: "Kami cek" }),
        row(4, "actions", { actions: ["Evakuasi"] }),
        row(5, "actions", { actions: ["Dapur umum"] }),
        row(6, "correction", { version: 2 }),
      ]),
    ).toEqual([
      message(1, {
        status: { status: "under_review", reason: null },
        reply: "Kami cek",
        actions: ["Evakuasi", "Dapur umum"],
        corrected: 2,
      }),
    ]);
  });

  test("another ticket, or another moment, is a message of its own, in order", () => {
    expect(
      newsMessages([
        row(1, "reply", { reply: "satu" }),
        row(2, "reply", { reply: "dua", atMs: 2000 }),
        row(3, "reply", { reply: "tiga", ticketNumber: "LA-251126-02" }),
        row(4, "document", { version: 1, atMs: 2000 }),
      ]),
    ).toEqual([
      message(1, { reply: "satu" }),
      message(2, { reply: "dua", atMs: 2000, document: 1 }),
      message(3, { reply: "tiga", ticketNumber: "LA-251126-02" }),
    ]);
    expect(newsMessages([])).toEqual([]);
  });

  test("a note is told only as the reason a report is set aside", () => {
    const [aside] = newsMessages([row(1, "status", { status: "invalid", note: "Kejadian lama" })]);
    expect(aside?.status).toEqual({ status: "invalid", reason: "Kejadian lama" });
    const [closed] = newsMessages([row(1, "status", { status: "closed", note: "Sudah surut" })]);
    expect(closed?.status).toEqual({ status: "closed", reason: null });
  });

  test("a long list is cut at eight, and says how many are left", () => {
    expect(NEWS_LINES).toBe(8);
    const lines = (count: number) => Array.from({ length: count }, (_, index) => index);
    expect(firstLines(lines(8))).toEqual({ shown: lines(8), left: 0 });
    expect(firstLines(lines(10))).toEqual({ shown: lines(8), left: 2 });
    expect(firstLines([])).toEqual({ shown: [], left: 0 });
  });

  test("news waits a week at most", () => {
    expect(NEWS_WAITS_MS).toBe(7 * 24 * 3_600_000);
  });
});
