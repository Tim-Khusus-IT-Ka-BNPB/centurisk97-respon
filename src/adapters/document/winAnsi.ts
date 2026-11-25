// The fonts every PDF reader has draw one byte per character, in the Windows Latin encoding.
// Everything here works on text already in that encoding: one character per byte.

// Bytes 0x80 to 0x9f; a full stop stands where the encoding has no character.
const HIGH = "€.‚ƒ„…†‡ˆ‰Š‹Œ.Ž..‘’“”•–—˜™š›œ.žŸ";

function byteOf(character: string): string | null {
  const code = character.codePointAt(0) as number;
  if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return character;
  const high = HIGH.indexOf(character);
  return high === -1 ? null : String.fromCharCode(0x80 + high);
}

// A character with no place in the encoding is written by its nearest Latin letter, or as "?".
// Marks that only change how the character before them looks are left out.
export function winAnsi(text: string): string {
  let out = "";
  for (const character of text.normalize("NFC").replace(/\s/g, " ")) {
    const byte = byteOf(character);
    if (byte !== null) out += byte;
    else if (!/[\p{M}\p{Cf}]/u.test(character)) {
      const letters = character.normalize("NFKD").replace(/\p{M}/gu, "");
      out += [...letters].every((letter) => byteOf(letter) !== null) ? letters : "?";
    }
  }
  return out;
}

const widths = (list: string) => list.split(" ").map(Number);

// Advance widths in thousandths of the size, for bytes 0x20 to 0xff.
const REGULAR = widths(
  "278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584 0 556 0 222 556 333 1000 556 556 333 1000 667 333 1000 0 611 0 0 222 222 333 333 350 556 1000 333 1000 500 333 944 0 500 667 278 333 556 556 556 556 260 556 333 737 370 556 584 333 737 333 400 549 333 333 333 576 537 278 333 333 365 556 834 834 834 611 667 667 667 667 667 667 1000 722 667 667 667 667 278 278 278 278 722 722 778 778 778 778 778 584 778 722 722 722 722 667 667 611 556 556 556 556 556 556 889 500 556 556 556 556 278 278 278 278 556 556 556 556 556 556 556 584 611 556 556 556 556 500 556 500",
);
const BOLD = widths(
  "278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584 0 556 0 278 556 500 1000 556 556 333 1000 667 333 1000 0 611 0 0 278 278 500 500 350 556 1000 333 1000 556 333 944 0 500 667 278 333 556 556 556 556 280 556 333 737 370 556 584 333 737 333 400 549 333 333 333 576 556 278 333 333 365 556 834 834 834 611 722 722 722 722 722 722 1000 722 667 667 667 667 278 278 278 278 722 722 778 778 778 778 778 584 778 722 722 722 722 667 667 611 556 556 556 556 556 556 889 556 556 556 556 556 278 278 278 278 611 611 611 611 611 611 611 584 611 611 611 611 611 556 611 556",
);

// The italic's widths are the upright's.
export type Font = "regular" | "bold" | "italic";

// How wide encoded text is at this size, in points.
export function textWidth(encoded: string, font: Font, size: number): number {
  const table = font === "bold" ? BOLD : REGULAR;
  let total = 0;
  for (const byte of encoded) total += table[byte.charCodeAt(0) - 0x20] as number;
  return (total * size) / 1000;
}

// The encoded text in lines no wider than this. A word longer than a line is broken inside.
export function wrapped(encoded: string, font: Font, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of encoded.split(" ")) {
    const joined = line === "" ? word : `${line} ${word}`;
    if (textWidth(joined, font, size) <= width) {
      line = joined;
      continue;
    }
    if (line !== "") lines.push(line);
    line = "";
    for (const byte of word) {
      if (textWidth(line + byte, font, size) > width) {
        lines.push(line);
        line = "";
      }
      line += byte;
    }
  }
  return [...lines, line];
}
