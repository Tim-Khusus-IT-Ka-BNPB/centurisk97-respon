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

  // Each of these was rendered and read back to its exact text by the macOS Vision reader before
  // it was pinned here, from version 1 to version 40. A change to any module changes its print;
  // re-check the decode before updating the snapshot.
  test("the codes of 14 texts from version 1 to 40 stay exactly as decoded", () => {
    const text = (n: number) => Array.from({ length: n }, (_, i) => "Lapor-Bencana 0123456789#t=abc/"[i % 31]).join("");
    const fingerprint = (rows: boolean[][]) => {
      let hash = 2166136261;
      for (const row of rows) for (const dark of row) hash = Math.imul(hash ^ (dark ? 1 : 0), 16777619) >>> 0;
      return `${rows.length}:${hash.toString(16)}`;
    };
    const prints = Object.fromEntries(
      [1, 14, 20, 60, 120, 140, 180, 230, 400, 700, 1000, 1500, 2000, 2331].map((n) => [
        n,
        fingerprint(qrModules(text(n))),
      ]),
    );
    expect(prints).toMatchSnapshot();
    // 180 bytes fit version 9 only with its 8-bit length field.
    expect(prints[180]).toMatch(/^53:/);
  });

  // Every mask at two versions, each decoded back to its text before it was pinned: a wrong mask
  // formula makes a code no reader can scan.
  test("each of the eight masks gives the same code as decoded, at version 2 and version 7", () => {
    const fingerprint = (rows: boolean[][]) => {
      let hash = 2166136261;
      for (const row of rows) for (const dark of row) hash = Math.imul(hash ^ (dark ? 1 : 0), 16777619) >>> 0;
      return hash.toString(16);
    };
    const prints = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => [
      fingerprint(qrModules("https://example.test/x", mask)),
      fingerprint(qrModules("M".repeat(140), mask)),
    ]);
    expect(prints).toMatchSnapshot();
  });
});
