/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { nextTheme, safeReturn, themeFromCookie } from "./theme";

describe("theme", () => {
  test("is read from its cookie; anything else is the device's own setting", () => {
    expect(themeFromCookie("a=1; theme=dark")).toBe("dark");
    expect(themeFromCookie("theme=light")).toBe("light");
    expect(themeFromCookie("theme=blue")).toBe("device");
    expect(themeFromCookie("xtheme=dark")).toBe("device");
    expect(themeFromCookie(null)).toBe("device");
  });

  test("one button walks device, light, dark and back", () => {
    expect(nextTheme("device")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("device");
  });

  test("returns only to a page of this site", () => {
    expect(safeReturn("/lapor/meja?view=map")).toBe("/lapor/meja?view=map");
    expect(safeReturn("/lapor")).toBe("/lapor");
    expect(safeReturn("//evil.example")).toBe("/lapor");
    expect(safeReturn("/laporan")).toBe("/lapor");
    expect(safeReturn("https://evil.example/lapor")).toBe("/lapor");
    expect(safeReturn(null)).toBe("/lapor");
  });

  test("the dark tokens are the same whether picked or followed from the device", () => {
    const css = readFileSync("app/app.css", "utf8");
    const tokens = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      expect(start, selector).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("}", start)).match(/--[\w-]+:[^;]+;/g);
    };
    const picked = tokens(':root[data-theme="dark"]');
    expect(picked?.length).toBeGreaterThan(20);
    expect(tokens(':root:not([data-theme="light"])')).toEqual(picked);
  });
});
