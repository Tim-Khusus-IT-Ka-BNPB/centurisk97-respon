import { afterEach, describe, expect, test, vi } from "vitest";
import { dropReport, keepReport, keptPhotoForm, keptReports, type OfflineReport, photoText, sendKept } from "./offline";

const report = (clientId: string): OfflineReport => ({ clientId, lat: 5.1, lon: 97, accuracyM: 12, takenAtMs: 1 });
const SENT = { ticketNumber: "LA-241126-01", trackingToken: "t", contact: { level: "national" as const } };

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("reports kept on the phone", () => {
  test("kept once each by id, in order, and dropped by id", () => {
    keepReport(report("a"));
    keepReport(report("b"));
    keepReport({ ...report("a"), hazardType: "flood" });
    expect(keptReports().map((one) => [one.clientId, one.hazardType])).toEqual([
      ["b", undefined],
      ["a", "flood"],
    ]);
    dropReport("b");
    dropReport("a");
    expect(localStorage.getItem("respon-offline-reports")).toBeNull();
  });

  test("storage that cannot be read or written keeps nothing and breaks nothing", () => {
    localStorage.setItem("respon-offline-reports", "{not json");
    expect(keptReports()).toEqual([]);
    localStorage.setItem("respon-offline-reports", '{"a":1}');
    expect(keptReports()).toEqual([]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("refused");
    });
    expect(keepReport(report("a"))).toBe(false);
  });

  test("sent oldest first: sent and refused go, the network's failure and too soon stay", async () => {
    for (const id of ["a", "b", "c", "d"]) keepReport(report(id));
    const answers = {
      a: { kind: "ok", body: SENT },
      b: { kind: "refused", status: 422, envelope: {} },
      c: { kind: "refused", status: 429, envelope: {} },
    } as const;
    const post = vi.fn(async (one: OfflineReport) => answers[one.clientId as "a"] ?? { kind: "unreachable" as const });
    const none = vi.fn();
    expect(await sendKept(post as never, none)).toEqual({ sent: [SENT], refused: 1, photosRefused: 0, left: 2 });
    expect(keptReports().map((one) => one.clientId)).toEqual(["c", "d"]);
    dropReport("c");
    expect(await sendKept(post as never, none)).toEqual({ sent: [], refused: 0, photosRefused: 0, left: 1 });
    expect(none).not.toHaveBeenCalled();
  });

  test("a sent report's photos go after it, in order; one that waits keeps the report for next time", async () => {
    const photo = (jpeg: string) => ({ jpeg, fix: null });
    keepReport({ ...report("a"), photos: [photo("AQ=="), photo("Ag=="), photo("Aw==")] });
    const post = vi.fn(async () => ({ kind: "ok" as const, body: SENT }));
    const sent: string[] = [];
    let line = false;
    const postPhoto = vi.fn(async (clientId: string, index: number) => {
      sent.push(`${clientId}:${index}`);
      if (index === 1) return { kind: "refused" as const, status: 422, envelope: {} as never };
      return index === 2 && !line ? { kind: "unreachable" as const } : { kind: "ok" as const, body: { photos: 1 } };
    });
    expect(await sendKept(post, postPhoto)).toEqual({ sent: [], refused: 0, photosRefused: 0, left: 1 });
    line = true;
    expect(await sendKept(post, postPhoto)).toEqual({ sent: [SENT], refused: 0, photosRefused: 1, left: 0 });
    expect(sent).toEqual(["a:0", "a:1", "a:2", "a:0", "a:1", "a:2"]);
  });
});

describe("a photo kept on the phone", () => {
  test("is kept as text and goes as a JPEG with its place, the phone's offset and its fix", async () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, n) => n % 256);
    const jpeg = photoText(bytes);
    const fix = { lat: 5.1, lon: 97, accuracy: 12, readAt: 1000 };
    const form = keptPhotoForm(2, { jpeg, fix }, 420);
    const file = form.get("photo") as File;
    expect([file.name, file.type]).toEqual(["foto.jpg", "image/jpeg"]);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(Object.fromEntries([...form.entries()].filter(([name]) => name !== "photo"))).toEqual({
      index: "2",
      offset: "420",
      lat: "5.1",
      lon: "97",
      accuracy: "12",
      readAt: "1000",
    });
    expect([...keptPhotoForm(0, { jpeg, fix: null }, 0).keys()]).toEqual(["photo", "index", "offset"]);
  });
});
