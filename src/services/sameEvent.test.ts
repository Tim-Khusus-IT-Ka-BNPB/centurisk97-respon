import { describe, expect, test } from "vitest";
import { EMPTY_CONTENT } from "../domain/turn/content";
import type { TurnDraft } from "../domain/turn/engine";
import { testBindings } from "../testing/api";
import { candidateOf, withSameEvent } from "./sameEvent";

const row = (fields: object) => ({
  ticket_number: "LA-241126-01",
  hazard_type: "flood",
  status: "new" as const,
  sent_at: "2026-11-24T03:00:00.000Z",
  fields: fields,
});

describe("a report offered as the same event", () => {
  test("its subtype and time as sent, an unknown subtype as none, a time with its hour as an instant", () => {
    const timed = { kind: "dateTime", localDate: "2026-11-24", localTime: "08:00", zone: "WIB" };
    expect(
      candidateOf(
        row({ hazardSubtype: { state: "value", value: "flashFlood" }, eventTime: { state: "value", value: timed } }),
        2,
      ),
    ).toMatchObject({
      hazardSubtype: "flashFlood",
      eventTime: timed,
      eventMs: Date.UTC(2026, 10, 24, 1),
      reporters: 2,
    });
    expect(
      candidateOf(row({ hazardSubtype: { state: "value", value: "unknown" }, eventTime: { state: "notYetKnown" } }), 1),
    ).toMatchObject({
      hazardSubtype: null,
      eventTime: null,
      eventMs: null,
    });
  });

  test("offered only once the place is known, once, and never in an emergency or news", async () => {
    const { bindings } = testBindings();
    const draft = (content: object): TurnDraft =>
      ({ state: "asking", revision: 1, asked: {}, content: { ...EMPTY_CONTENT, ...content } }) as unknown as TurnDraft;
    const neighbourhood = { states: { neighbourhood: { state: "confirmedUnknown", origin: "tappedOption" } } };
    const placeOnly = draft({});
    for (const [before, content] of [
      [placeOnly, {}],
      [placeOnly, { ...neighbourhood, sameEvent: null }],
      [placeOnly, { ...neighbourhood, emergency: { victims: null } }],
      [placeOnly, { ...neighbourhood, followUp: { ticketNumber: "LA-1", base: {}, photosLeft: 1 } }],
      // A draft that had its RT and RW before this was offered at all.
      [draft(neighbourhood), neighbourhood],
    ] as const) {
      const after = draft(content);
      expect(await withSameEvent(bindings, before, after)).toBe(after);
    }
  });
});
