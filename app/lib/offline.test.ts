import { afterEach, describe, expect, test, vi } from "vitest";
import { dropReport, keepReport, keptReports, type OfflineReport, sendKept } from "./offline";

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
    expect(localStorage.getItem("lapor-offline-reports")).toBeNull();
  });

  test("storage that cannot be read or written keeps nothing and breaks nothing", () => {
    localStorage.setItem("lapor-offline-reports", "{not json");
    expect(keptReports()).toEqual([]);
    localStorage.setItem("lapor-offline-reports", '{"a":1}');
    expect(keptReports()).toEqual([]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("refused");
    });
    expect(() => keepReport(report("a"))).not.toThrow();
  });

  test("sent oldest first: sent and refused go, the network's failure and too soon stay", async () => {
    for (const id of ["a", "b", "c", "d"]) keepReport(report(id));
    const answers = {
      a: { kind: "ok", body: SENT },
      b: { kind: "refused", status: 422, envelope: {} },
      c: { kind: "refused", status: 429, envelope: {} },
    } as const;
    const post = vi.fn(async (one: OfflineReport) => answers[one.clientId as "a"] ?? { kind: "unreachable" as const });
    expect(await sendKept(post as never)).toEqual({ sent: [SENT], refused: 1, left: 2 });
    expect(keptReports().map((one) => one.clientId)).toEqual(["c", "d"]);
    dropReport("c");
    expect(await sendKept(post as never)).toEqual({ sent: [], refused: 0, left: 1 });
  });
});
