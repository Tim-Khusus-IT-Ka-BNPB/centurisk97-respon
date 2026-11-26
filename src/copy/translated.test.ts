import { describe, expect, test } from "vitest";
import { copy } from ".";
import { LANGUAGES, languageFrom, OFFERED } from "./languages";
import { isTranslated, TRANSLATED, translationProblem } from "./translated";
import { TRANSLATIONS } from "./translations";

describe("a translated line", () => {
  test("keeps its placeholders and numbers, is no answer, and never calls anything safe", () => {
    expect(translationProblem("Hujan {mm} mm, 3 hari", "Ujeun {mm} mm, 3 uroe")).toBeNull();
    expect(translationProblem("Hujan {mm} mm", "")).toBe("empty");
    expect(translationProblem("Hujan {mm} mm", "Ujeun mm")).toBe("placeholders");
    expect(translationProblem("Hujan {mm} mm", "Ujeun {mm} {jam} mm")).toBe("placeholders");
    expect(translationProblem("Telepon 112", "Telepon 113")).toBe("numbers");
    expect(translationProblem("Telepon 112", "Telepon 112 atau 117")).toBe("numbers");
    expect(translationProblem("Ya", "x".repeat(46))).toBe("tooLong");
    expect(translationProblem("Ya", "x".repeat(45))).toBeNull();
    expect(translationProblem("Di sini", "Di sini aman")).toBe("safeWord");
    expect(translationProblem("Di sini", "Di sini keamanan")).toBeNull();
  });

  test("the report pages' words are translated; the file's own language never", () => {
    expect(isTranslated("card.placeSearch.title")).toBe(true);
    expect(isTranslated("about.step3.title")).toBe(true);
    expect(isTranslated("app.lang")).toBe(false);
    expect(isTranslated("desk.title")).toBe(false);
    expect(isTranslated("info.title")).toBe(false);
    expect(TRANSLATED.every((prefix) => copy.keys.some((key) => key.startsWith(prefix)))).toBe(true);
  });
});

describe("the language files", () => {
  test("each names its own language, holds only report words of the Indonesian catalogue, and passes each line", () => {
    for (const [language, words] of TRANSLATIONS) {
      expect(
        LANGUAGES.some(([id]) => id === language),
        language,
      ).toBe(true);
      expect(words["app.lang"]).toBe(language);
      for (const [key, line] of Object.entries(words)) {
        if (key === "app.lang") continue;
        expect(copy.has(key) && isTranslated(key), `${language} ${key}`).toBe(true);
        expect(translationProblem(copy.text(key), line), `${language} ${key}`).toBeNull();
      }
    }
  });

  test("a browser's language is one offered, or Indonesian", () => {
    expect(OFFERED[0]).toEqual(["id", "Bahasa Indonesia"]);
    expect(languageFrom(null)).toBe("id");
    expect(languageFrom("theme=dark; bahasa=xx")).toBe("id");
    expect(languageFrom("bahasa=id")).toBe("id");
    for (const [id] of OFFERED) expect(languageFrom(`theme=dark; bahasa=${id}`)).toBe(id);
  });
});
