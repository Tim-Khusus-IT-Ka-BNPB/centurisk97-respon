import { describe, expect, test } from "vitest";
import { chronologyText, joinChronology, stepSentence } from "./sentence";

const phraseOf = (key: string) => {
  const parts = key.split(".");
  if (parts.at(-1) === "prefix") return "Genangan merendam";
  const id = parts.at(-2) as string;
  return id === "homes" ? "dan menghanguskan rumah tinggal." : `Frasa ${id}`;
};

describe("joining the chronology", () => {
  test("a sentence in lower case continues the one before, any other starts a new one, and it ends with a stop", () => {
    expect(joinChronology([])).toBe("");
    expect(joinChronology(["Kebakaran diduga dari kompor", "dan menghanguskan rumah tinggal."])).toBe(
      "Kebakaran diduga dari kompor dan menghanguskan rumah tinggal.",
    );
    expect(joinChronology(["Api muncul.", "dan menjalar"])).toBe("Api muncul dan menjalar.");
    expect(joinChronology(["Api muncul", "Asap tebal"])).toBe("Api muncul. Asap tebal.");
    expect(joinChronology(["Api muncul!", "Asap tebal?"])).toBe("Api muncul! Asap tebal?");
    expect(joinChronology(["Api muncul?", "Asap tebal"])).toBe("Api muncul? Asap tebal.");
    expect(joinChronology(["Ébranlé", "écrit"])).toBe("Ébranlé écrit.");
  });
});

describe("one step's sentence", () => {
  const answers = (steps: string[][], otherText: Record<number, string> = {}) => ({ steps, otherText });
  test("a single step is its phrase; a silent answer adds nothing", () => {
    expect(stepSentence("flood", 0, answers([["heavyRain"]]), phraseOf)).toBe("Frasa heavyRain");
    expect(stepSentence("flood", 0, answers([["heavyRain"]]), (key) => key)).toBe(
      "chronology.flood.step1.option.heavyRain.phrase",
    );
    expect(stepSentence("flood", 1, answers([["x"], ["unknown"]]), phraseOf)).toBeNull();
    expect(stepSentence("other", 0, answers([["x"]]), phraseOf)).toBeNull();
  });

  test("a multiple step is its prefix and the phrases, a typed Lainnya joined in lower case", () => {
    expect(
      stepSentence("flood", 2, answers([["a"], ["b"], ["homes", "roads", "other"]], { 2: "Lapangan bola" }), phraseOf),
    ).toBe("Genangan merendam dan menghanguskan rumah tinggal., Frasa roads, lapangan bola.");
    expect(stepSentence("flood", 2, answers([["a"], ["b"], ["other"]]), phraseOf)).toBeNull();
    expect(stepSentence("flood", 2, answers([["a"], ["b"], ["nope"]]), phraseOf)).toBeNull();
  });

  test("the whole chronology ends with the reporter's note", () => {
    expect(
      chronologyText("buildingFire", answers([["sawSmoke"], ["unknown"], ["homes"]]), "Ada tabung gas", phraseOf),
    ).toBe("Frasa sawSmoke. Frasa unknown dan menghanguskan rumah tinggal. Ada tabung gas.");
    expect(chronologyText("flood", answers([]), null, phraseOf)).toBe("");
    expect(chronologyText("flood", answers([["heavyRain"], ["unknown"], ["roads"]]), null, phraseOf)).toBe(
      "Frasa heavyRain. Genangan merendam Frasa roads.",
    );
  });
});
