import { describe, expect, test } from "vitest";
import { foldEvents } from "./deskEvents";

const item = (ticketNumber: string, tickets: string[] | null = null) => ({
  ticketNumber,
  cluster: tickets === null ? null : { tickets },
});

describe("one row per event", () => {
  test("an event's first report on the page heads it, its others fold under it in page order", () => {
    const event = ["A", "C", "E"];
    const folded = foldEvents([item("E", event), item("B"), item("A", event), item("D", ["D", "X"]), item("C", event)]);
    expect(folded.map((group) => [group.head.ticketNumber, group.members.map((one) => one.ticketNumber)])).toEqual([
      ["E", ["A", "C"]],
      ["B", []],
      ["D", []],
    ]);
  });

  test("nothing to fold, and an empty page", () => {
    expect(foldEvents([item("A"), item("B")]).map((group) => group.members)).toEqual([[], []]);
    expect(foldEvents([])).toEqual([]);
  });
});
