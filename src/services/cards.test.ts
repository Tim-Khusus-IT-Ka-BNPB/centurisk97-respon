import { describe, expect, test } from "vitest";
import { copy } from "../copy";
import { FIELDS } from "../domain/fields/catalogue";
import { EMPTY_CONTENT } from "../domain/turn/content";
import { type CardContext, cardFor } from "./cards";

const context: CardContext = {
  cardId: "c-1",
  nowMs: Date.parse("2026-11-24T03:00:00.000Z"),
  zone: "WIB",
  reporter: { name: "Uji Satu", role: "citizen" },
  completePercent: 0,
  asked: {},
  photos: [],
};

describe("choice cards", () => {
  test("hazard types guessed from the reporter's words come first and are flagged as guesses", () => {
    const card = cardFor(
      { kind: "choice", fieldId: "hazardType" },
      { ...EMPTY_CONTENT, guesses: ["drought", "flood"] },
      context,
    );
    if (card.kind !== "choice") throw new Error("not a choice card");
    expect(card.options.slice(0, 3).map((option) => [option.id, option.guess])).toEqual([
      ["drought", true],
      ["flood", true],
      ["landslide", false],
    ]);
    expect(card.options.filter((option) => option.guess)).toHaveLength(2);
  });

  test("with no guess no hazard type is flagged", () => {
    const card = cardFor({ kind: "choice", fieldId: "hazardType" }, EMPTY_CONTENT, context);
    expect(card.kind === "choice" && card.options.every((option) => option.guess === false)).toBe(true);
  });

  test("every choice of every field has its own label; only Tidak tahu borrows the shared one", () => {
    const missing: string[] = [];
    for (const field of FIELDS) {
      if (field.kind !== "choice" && field.kind !== "multiChoice") continue;
      const card = cardFor({ kind: field.kind, fieldId: field.id }, EMPTY_CONTENT, context);
      if (card.kind !== "choice" && card.kind !== "multiChoice") continue;
      for (const option of card.options) {
        if (option.id === "unknown") expect(option.labelKey).toBe("common.unknown");
        else if (!copy.has(option.labelKey)) missing.push(option.labelKey);
      }
    }
    expect(missing).toEqual([]);
  });
});
