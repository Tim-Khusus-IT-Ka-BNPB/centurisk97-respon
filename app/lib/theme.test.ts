import { describe, expect, test } from "vitest";
import { nextTheme, safeReturn, themeFromCookie } from "./theme";

describe("theme", () => {
  test("is read from its cookie; anything else is light", () => {
    expect(themeFromCookie("a=1; theme=dark")).toBe("dark");
    expect(themeFromCookie("theme=dark; b=2")).toBe("dark");
    expect(themeFromCookie("theme=light")).toBe("light");
    expect(themeFromCookie("theme=darker")).toBe("light");
    expect(themeFromCookie("xtheme=dark")).toBe("light");
    expect(themeFromCookie(null)).toBe("light");
  });

  test("one button flips light and dark", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
  });

  test("returns only to a page of this site", () => {
    expect(safeReturn("/lapor/meja?view=map")).toBe("/lapor/meja?view=map");
    expect(safeReturn("/lapor")).toBe("/lapor");
    expect(safeReturn("//evil.example")).toBe("/lapor");
    expect(safeReturn("/laporan")).toBe("/lapor");
    expect(safeReturn("https://evil.example/lapor")).toBe("/lapor");
    expect(safeReturn(null)).toBe("/lapor");
  });
});
