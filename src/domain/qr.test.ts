import { describe, expect, test } from "vitest";
import { qrModules, qrPath } from "./qr";

// Each was decoded back to its text by a phone-grade reader when the encoder was written.
const finder = (modules: boolean[][], x: number, y: number) =>
  [0, 1, 2, 3, 4, 5, 6].map((dy) => [0, 1, 2, 3, 4, 5, 6].map((dx) => (modules[y + dy] as boolean[])[x + dx]));
const FINDER = [0, 1, 2, 3, 4, 5, 6].map((y) =>
  [0, 1, 2, 3, 4, 5, 6].map((x) => Math.max(Math.abs(x - 3), Math.abs(y - 3)) !== 2),
);

describe("qr", () => {
  test("the smallest version that holds the text, with its three finder patterns", () => {
    const sizes = [
      "Hello, world!",
      "https://lapor-bencana.centurisk97.id/lapor/lacak#t=0123456789abcdef0123456789abcdef",
      "x".repeat(300),
      "y".repeat(1500),
    ].map((text) => qrModules(text).length);
    expect(sizes).toEqual([21, 37, 69, 145]);
    const modules = qrModules("Hello, world!");
    expect(finder(modules, 0, 0)).toEqual(FINDER);
    expect(finder(modules, 14, 0)).toEqual(FINDER);
    expect(finder(modules, 0, 14)).toEqual(FINDER);
    // The dark module beside the lower finder.
    expect((modules[13] as boolean[])[8]).toBe(true);
  });

  test("the same text gives the same code; a text too long for any version is refused", () => {
    expect(qrModules("LA-231126-01")).toEqual(qrModules("LA-231126-01"));
    expect(() => qrModules("z".repeat(3000))).toThrow("Text too long for a QR code");
  });

  test("the path draws one square per dark module, inside a 4-module quiet zone", () => {
    expect(
      qrPath([
        [true, false],
        [false, true],
      ]),
    ).toBe("M4 4h1v1h-1zM5 5h1v1h-1z");
  });
});
