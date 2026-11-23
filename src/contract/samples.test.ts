import { describe, expect, test } from "vitest";
import { copy } from "../copy";
import { chronologySteps } from "../domain/chronology";
import { fieldById, isFieldId } from "../domain/fields/catalogue";
import { SAMPLE_DRAFTS, SAMPLE_FIELD_ERROR, SAMPLE_ME, SAMPLE_STALE_TURN } from "../testing/samples";
import { CARD_KINDS } from "./card";
import { draftBodySchema, meResponseSchema } from "./draft";
import { errorCopyKey, errorEnvelopeSchema } from "./errors";

describe("contract samples", () => {
  test("one sample draft body per card kind, each valid", () => {
    expect(Object.keys(SAMPLE_DRAFTS).sort()).toEqual([...CARD_KINDS].sort());
    for (const kind of CARD_KINDS) {
      const body = SAMPLE_DRAFTS[kind];
      expect(draftBodySchema.parse(body)).toEqual(body);
      expect(body.card.kind).toBe(kind);
    }
  });

  test("field and option ids in samples exist in the field spec", () => {
    const choice = SAMPLE_DRAFTS.multiChoice.card;
    if (choice.kind !== "multiChoice" || !isFieldId(choice.fieldId)) throw new Error("sample shape");
    const field = fieldById(choice.fieldId);
    const known = "options" in field ? field.options.map((option) => option.id) : [];
    expect(known).toEqual(expect.arrayContaining(choice.options.map((option) => option.id)));
    const step = SAMPLE_DRAFTS.chronologyStep.card;
    if (step.kind !== "chronologyStep") throw new Error("sample shape");
    const steps = chronologySteps("flood");
    expect(step.total).toBe(steps.length);
    expect(steps[step.step - 1]?.options.map((option) => option.id)).toEqual(step.options.map((option) => option.id));
  });

  test("every copy key a sample carries exists in the catalogue", () => {
    const keys: string[] = [];
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (typeof value === "object" && value !== null)
        for (const [name, entry] of Object.entries(value)) {
          if (name.endsWith("Key") && typeof entry === "string") keys.push(entry);
          else collect(entry);
        }
    };
    collect([SAMPLE_DRAFTS, SAMPLE_STALE_TURN, SAMPLE_FIELD_ERROR, SAMPLE_ME]);
    expect(keys.length).toBeGreaterThan(50);
    expect(keys.filter((key) => !copy.has(key))).toEqual([]);
  });

  test("envelope and me samples are valid", () => {
    expect(errorEnvelopeSchema.parse(SAMPLE_STALE_TURN)).toEqual(SAMPLE_STALE_TURN);
    expect(errorEnvelopeSchema.parse(SAMPLE_FIELD_ERROR)).toEqual(SAMPLE_FIELD_ERROR);
    expect(meResponseSchema.parse(SAMPLE_ME)).toEqual(SAMPLE_ME);
  });

  test("schemas refuse what the contract forbids", () => {
    const stale = structuredClone(SAMPLE_STALE_TURN);
    expect(errorEnvelopeSchema.safeParse({ ...stale, error: { ...stale.error, code: "oops" } }).success).toBe(false);
    const summary = structuredClone(SAMPLE_DRAFTS.summary);
    expect(draftBodySchema.safeParse({ ...summary, completePercent: 101 }).success).toBe(false);
    expect(draftBodySchema.safeParse({ ...summary, state: "identity" }).success).toBe(false);
    expect(draftBodySchema.safeParse({ ...summary, card: { ...summary.card, kind: "poem" } }).success).toBe(false);
    expect(
      draftBodySchema.safeParse({ ...summary, keptUntil: { utc: "2026-11-24T01:01:00.000Z", zone: "UTC" } }).success,
    ).toBe(false);
  });

  test("copy keys of envelope codes", () => {
    expect(errorCopyKey("draft.changed")).toBe("error.draft.changed");
    expect(errorCopyKey("limit.send.rolling")).toBe("limit.send.rolling");
    expect(errorCopyKey("draft.expired")).toBe("card.expired.body");
    expect(errorCopyKey("draft.openExists")).toBe("card.confirm.replaceDraft.body");
  });
});
