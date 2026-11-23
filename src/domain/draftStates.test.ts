import { describe, expect, test } from "vitest";
import { canMove, DRAFT_MOVES, DRAFT_STATES, FIRST_DRAFT_STATE, isDraftState, isFinal } from "./draftStates";

describe("draft states", () => {
  test("the state map as agreed", () => {
    expect(DRAFT_MOVES).toMatchSnapshot();
    expect(FIRST_DRAFT_STATE).toBe("place");
  });

  test("sent, cancelled and expired are final and nothing leaves them", () => {
    expect(DRAFT_STATES.filter(isFinal)).toEqual(["sent", "cancelled", "expired"]);
    for (const to of DRAFT_STATES) {
      expect(canMove("sent", to)).toBe(false);
      expect(canMove("cancelled", to)).toBe(false);
    }
  });

  test("every open state can be cancelled or expire", () => {
    for (const from of DRAFT_STATES.filter((state) => !isFinal(state))) {
      expect(canMove(from, "cancelled")).toBe(true);
      expect(canMove(from, "expired")).toBe(true);
    }
  });

  test("only the summary sends", () => {
    expect(DRAFT_STATES.filter((from) => canMove(from, "sent"))).toEqual(["summary"]);
  });

  test("moves outside the map are refused", () => {
    expect(canMove("place", "summary")).toBe(false);
    expect(canMove("neighbourhood", "place")).toBe(false);
    expect(canMove("asking", "sent")).toBe(false);
    expect(canMove("summary", "asking")).toBe(true);
  });

  test("state names", () => {
    expect(isDraftState("asking")).toBe(true);
    expect(isDraftState("identity")).toBe(false);
    expect(isDraftState("constructor")).toBe(false);
    expect(isDraftState(null)).toBe(false);
  });
});
