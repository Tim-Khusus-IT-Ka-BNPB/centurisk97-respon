import { describe, expect, test, vi } from "vitest";
import { drawnTheme, nextTheme, safeReturn, themeFromCookie } from "./theme";

describe("theme", () => {
  test("is read from its cookie; anything else is light", () => {
    expect(themeFromCookie("a=1; theme=dark")).toBe("dark");
    expect(themeFromCookie("theme=dark; b=2")).toBe("dark");
    expect(themeFromCookie("theme=light")).toBe("light");
    expect(themeFromCookie("theme=darker")).toBe("light");
    expect(themeFromCookie("xtheme=dark")).toBe("light");
    expect(themeFromCookie(null)).toBe("light");
  });

  test("stays as drawn when nothing else is known; on the server that is light", () => {
    expect(drawnTheme()).toBe("light");
    document.documentElement.dataset.theme = "dark";
    expect(drawnTheme()).toBe("dark");
    vi.stubGlobal("document", undefined);
    expect(drawnTheme()).toBe("light");
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.theme;
  });

  test("one button flips light and dark", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
  });

  test("returns only to a page of this site", () => {
    expect(safeReturn("/desk?view=map")).toBe("/desk?view=map");
    expect(safeReturn("/")).toBe("/");
    expect(safeReturn("//evil.example")).toBe("/");
    expect(safeReturn("/\\evil.example")).toBe("/");
    expect(safeReturn("/reports/LA-241126-01")).toBe("/reports/LA-241126-01");
    expect(safeReturn("https://evil.example/")).toBe("/");
    expect(safeReturn(null)).toBe("/");
  });
});
