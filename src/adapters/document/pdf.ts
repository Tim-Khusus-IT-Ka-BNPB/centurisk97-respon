import type { Cell, DocumentBlock, Picture, ReportDocument } from "../../domain/document";
import { type Font, textWidth, winAnsi, wrapped } from "./winAnsi";
import { join } from "./zip";

// The report as a PDF on A4, drawn with the fonts every reader has and its photos as they are
// stored. Lengths are points from the top left; the page's own origin is at its foot.

const PAGE = { width: 595, height: 842, left: 57, right: 538, top: 40, bottom: 786 } as const;
const WIDTH = PAGE.right - PAGE.left;

type Colour = readonly [red: number, green: number, blue: number];
const hex = (value: number): Colour => [value >> 16, (value >> 8) & 0xff, value & 0xff];
const NAVY = hex(0x0b2545);
const INK = hex(0x16202e);
const MUTED = hex(0x55617a);
const LINE = hex(0xd5dce6);
const TINT = hex(0xf1f4f8);
const WHITE = hex(0xffffff);
const BANDS = {
  alarm: { ground: hex(0xfbe4e1), ink: hex(0x9f1d13) },
  notice: { ground: hex(0xfdf1e3), ink: hex(0x8a3f06) },
  plain: { ground: TINT, ink: NAVY },
} as const;

const FONT_NAMES: Readonly<Record<Font, string>> = {
  regular: "Helvetica",
  bold: "Helvetica-Bold",
  italic: "Helvetica-Oblique",
};
const FONT_KEYS: Readonly<Record<Font, string>> = { regular: "F1", bold: "F2", italic: "F3" };

const LOOKS: Readonly<Record<Cell["look"], { readonly font: Font; readonly colour: Colour }>> = {
  label: { font: "regular", colour: MUTED },
  value: { font: "bold", colour: INK },
  empty: { font: "regular", colour: MUTED },
  words: { font: "italic", colour: MUTED },
};

const num = (value: number) => String(Number(value.toFixed(2)));
const paint = (colour: Colour) => colour.map((part) => num(part / 255)).join(" ");

// Encoded text as a PDF string.
const literal = (encoded: string) =>
  `(${encoded.replace(/[\\()]/g, "\\$&").replace(/[^ -~]/g, (byte) => `\\${byte.charCodeAt(0).toString(8)}`)})`;

type Style = { readonly font?: Font; readonly size: number; readonly colour?: Colour };

class Canvas {
  readonly pages: string[][] = [];
  readonly pictures = new Map<Picture, string>();
  y = 0;

  constructor() {
    this.turn();
  }

  turn(): void {
    this.pages.push([]);
    this.y = PAGE.top;
  }

  // Starts a new page when what comes next does not fit on this one.
  room(height: number): void {
    if (this.y + height > PAGE.bottom) this.turn();
  }

  put(op: string): void {
    (this.pages.at(-1) as string[]).push(op);
  }

  rect(x: number, y: number, width: number, height: number, colour: Colour): void {
    this.put(`${paint(colour)} rg ${num(x)} ${num(PAGE.height - y - height)} ${num(width)} ${num(height)} re f`);
  }

  rule(y: number, weight: number, colour: Colour): void {
    this.rect(PAGE.left, y, WIDTH, weight, colour);
  }

  // One line of encoded text, its baseline at y.
  text(x: number, y: number, encoded: string, { font = "regular", size, colour = INK }: Style): void {
    this.put(
      `BT /${FONT_KEYS[font]} ${num(size)} Tf ${paint(colour)} rg ${num(x)} ${num(PAGE.height - y)} Td ${literal(encoded)} Tj ET`,
    );
  }

  centred(middle: number, y: number, encoded: string, style: Style): void {
    this.text(middle - textWidth(encoded, style.font ?? "regular", style.size) / 2, y, encoded, style);
  }

  picture(picture: Picture, x: number, y: number, width: number, height: number): void {
    let name = this.pictures.get(picture);
    if (name === undefined) {
      name = `P${this.pictures.size + 1}`;
      this.pictures.set(picture, name);
    }
    this.put(`q ${num(width)} 0 0 ${num(height)} ${num(x)} ${num(PAGE.height - y - height)} cm /${name} Do Q`);
  }

  // Lines of text from y down; answers where they end.
  lines(x: number, y: number, lines: readonly string[], style: Style): number {
    const step = style.size * 1.35;
    lines.forEach((line, index) => {
      this.text(x, y + style.size + index * step, line, style);
    });
    return y + lines.length * step;
  }
}

function head(canvas: Canvas, document: ReportDocument): void {
  const top = PAGE.top;
  const box = 118;
  canvas.picture(document.emblem, PAGE.left, top, 48, 48);
  canvas.text(PAGE.left + 60, top + 13, winAnsi(document.agency.toUpperCase()), {
    font: "bold",
    size: 8.5,
    colour: MUTED,
  });
  canvas.text(PAGE.left + 60, top + 34, winAnsi(document.heading), { font: "bold", size: 19, colour: NAVY });
  canvas.text(PAGE.left + 60, top + 47, winAnsi(document.lead), { size: 8.5, colour: MUTED });
  canvas.rect(PAGE.right - box, top, box, 50, NAVY);
  const middle = PAGE.right - box / 2;
  canvas.centred(middle, top + 14, winAnsi(document.ticketLabel), { size: 7.5, colour: WHITE });
  canvas.centred(middle, top + 30, winAnsi(document.ticketNumber), { font: "bold", size: 12.5, colour: WHITE });
  canvas.centred(middle, top + 43, winAnsi(document.version), { size: 8, colour: WHITE });
  canvas.rule(top + 60, 2, NAVY);
  canvas.y = top + 70;
}

function band(canvas: Canvas, block: Extract<DocumentBlock, { kind: "band" }>): void {
  const { ground, ink } = BANDS[block.tone];
  const style: Style = { font: "bold", size: 9, colour: ink };
  const lines = wrapped(winAnsi(block.text), "bold", 9, WIDTH - 20);
  const height = lines.length * 9 * 1.35 + 11;
  canvas.room(height + 6);
  canvas.rect(PAGE.left, canvas.y, WIDTH, height, ground);
  canvas.lines(PAGE.left + 10, canvas.y + 5, lines, style);
  canvas.y += height + 6;
}

function figures(canvas: Canvas, block: Extract<DocumentBlock, { kind: "figures" }>): void {
  const gap = 6;
  const width = (WIDTH - gap * (block.figures.length - 1)) / block.figures.length;
  canvas.room(58);
  block.figures.forEach((figure, index) => {
    const x = PAGE.left + index * (width + gap);
    const middle = x + width / 2;
    canvas.rect(x, canvas.y, width, 50, TINT);
    const value = winAnsi(figure.value);
    if (figure.unit === null)
      canvas.centred(middle, canvas.y + 24, value, {
        font: figure.known ? "bold" : "regular",
        size: 11,
        colour: figure.known ? NAVY : MUTED,
      });
    else {
      const unit = winAnsi(` ${figure.unit}`);
      const start = middle - (textWidth(value, "bold", 18) + textWidth(unit, "regular", 8.5)) / 2;
      canvas.text(start, canvas.y + 26, value, { font: "bold", size: 18, colour: NAVY });
      canvas.text(start + textWidth(value, "bold", 18), canvas.y + 26, unit, { size: 8.5, colour: NAVY });
    }
    canvas.centred(middle, canvas.y + 41, winAnsi(figure.label), { size: 8, colour: MUTED });
  });
  canvas.y += 58;
}

function paragraph(canvas: Canvas, text: string, style: Required<Style>, indent = 0): void {
  for (const line of wrapped(winAnsi(text), style.font, style.size, WIDTH - indent)) {
    const step = style.size * 1.35;
    canvas.room(step);
    canvas.y = canvas.lines(PAGE.left + indent, canvas.y, [line], style);
  }
}

const HEADLINE: Required<Style> = { font: "bold", size: 12.5, colour: NAVY };
const BODY: Required<Style> = { font: "regular", size: 10, colour: INK };
const SMALL: Required<Style> = { font: "italic", size: 8, colour: MUTED };

function numbered(canvas: Canvas, block: Extract<DocumentBlock, { kind: "numbered" }>): void {
  block.items.forEach(({ label, lines }, index) => {
    const [only, ...more] = lines;
    const name = winAnsi(`${label}: `);
    canvas.room(30);
    const y = canvas.y + 10;
    canvas.text(PAGE.left, y, `${index + 1}.`, { font: "bold", size: 10 });
    canvas.text(PAGE.left + 18, y, name, { font: "bold", size: 10 });
    const after = textWidth(name, "bold", 10);
    if (more.length === 0) {
      // The first line starts beside its label, the rest under it.
      const [first = "", ...rest] = wrapped(winAnsi(only as string), "regular", 10, WIDTH - 18 - after);
      canvas.text(PAGE.left + 18 + after, y, first, BODY);
      canvas.y += 13.5;
      if (rest.length > 0) paragraph(canvas, rest.join(" "), BODY, 18);
    } else {
      canvas.y += 13.5;
      lines.forEach((line, at) => {
        canvas.room(13.5);
        canvas.text(PAGE.left + 18, canvas.y + 10, `${String.fromCharCode(97 + at)}.`, BODY);
        paragraph(canvas, line, BODY, 34);
      });
    }
    canvas.y += 3;
  });
}

function section(canvas: Canvas, text: string): void {
  // A heading never stands alone at the foot of a page.
  canvas.room(58);
  canvas.y += 10;
  canvas.y = canvas.lines(PAGE.left, canvas.y, [winAnsi(text)], { font: "bold", size: 11.5, colour: NAVY });
  canvas.rule(canvas.y + 1, 1, NAVY);
  canvas.y += 5;
}

function table(canvas: Canvas, block: Extract<DocumentBlock, { kind: "table" }>): void {
  const size = 9;
  const pad = 6;
  const widths = block.widths.map((share) => share * WIDTH);
  const starts = widths.map((_, index) => PAGE.left + widths.slice(0, index).reduce((sum, one) => sum + one, 0));
  const headRow = () => {
    if (block.head === null) return;
    block.head.forEach((text, index) => {
      canvas.text((starts[index] as number) + pad, canvas.y + 11, winAnsi(text), {
        font: "bold",
        size: 8,
        colour: MUTED,
      });
    });
    canvas.y += 16;
    canvas.rule(canvas.y, 0.75, LINE);
  };
  canvas.y += 3;
  canvas.room(40);
  headRow();
  let striped = false;
  for (const cells of block.rows) {
    if (typeof cells === "string") {
      // The name of a group stays with its first row.
      if (canvas.y + 44 > PAGE.bottom) {
        canvas.turn();
        headRow();
      }
      canvas.text(PAGE.left + pad, canvas.y + 19, winAnsi(cells), { font: "bold", size: 9, colour: NAVY });
      canvas.y += 24;
      canvas.rule(canvas.y, 0.5, LINE);
      striped = false;
      continue;
    }
    const columns = cells.map((cell, index) => ({
      look: LOOKS[cell.look],
      lines: wrapped(winAnsi(cell.text), LOOKS[cell.look].font, size, (widths[index] as number) - 2 * pad),
    }));
    const height = Math.max(...columns.map((column) => column.lines.length)) * size * 1.35 + 7;
    if (canvas.y + height > PAGE.bottom) {
      canvas.turn();
      headRow();
    }
    if (striped) canvas.rect(PAGE.left, canvas.y, WIDTH, height, TINT);
    striped = !striped;
    columns.forEach(({ look, lines }, index) => {
      canvas.lines((starts[index] as number) + pad, canvas.y + 3, lines, { ...look, size });
    });
    canvas.y += height;
    canvas.rule(canvas.y, 0.5, LINE);
  }
  canvas.y += 2;
}

function photos(canvas: Canvas, block: Extract<DocumentBlock, { kind: "photos" }>): void {
  const gap = 13;
  const width = (WIDTH - gap) / 2;
  const height = width * 0.75;
  for (let at = 0; at < block.photos.length; at += 2) {
    const row = block.photos.slice(at, at + 2).map((photo) => ({
      ...photo,
      lines: wrapped(winAnsi(photo.caption), "regular", 8, width),
    }));
    const caption = Math.max(...row.map((photo) => photo.lines.length)) * 8 * 1.35;
    canvas.room(height + caption + 14);
    canvas.y += 4;
    row.forEach(({ picture, lines }, index) => {
      const x = PAGE.left + index * (width + gap);
      // Whole, in the middle of its frame, never cropped.
      const scale = Math.min(width / picture.width, height / picture.height);
      const drawn = { width: picture.width * scale, height: picture.height * scale };
      canvas.rect(x, canvas.y, width, height, TINT);
      canvas.picture(
        picture,
        x + (width - drawn.width) / 2,
        canvas.y + (height - drawn.height) / 2,
        drawn.width,
        drawn.height,
      );
      canvas.lines(x, canvas.y + height + 3, lines, { size: 8, colour: MUTED });
    });
    canvas.y += height + caption + 10;
  }
}

const DRAW: {
  readonly [K in DocumentBlock["kind"]]: (canvas: Canvas, block: Extract<DocumentBlock, { kind: K }>) => void;
} = {
  band,
  figures,
  headline: (canvas, block) => {
    canvas.y += 12;
    paragraph(canvas, block.text, HEADLINE);
    canvas.y += 4;
  },
  numbered,
  section: (canvas, block) => section(canvas, block.text),
  paragraph: (canvas, block) => {
    canvas.y += 3;
    paragraph(canvas, block.text, block.small ? SMALL : BODY);
  },
  table,
  photos,
};

// The objects one after another, with the table that says where each one starts.
function assembled(objects: readonly (string | { readonly dict: string; readonly stream: Uint8Array })[]): Uint8Array {
  const bytes = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));
  const parts: Uint8Array[] = [bytes("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")];
  const offsets: number[] = [];
  let length = (parts[0] as Uint8Array).length;
  const add = (part: Uint8Array) => {
    parts.push(part);
    length += part.length;
  };
  objects.forEach((object, index) => {
    offsets.push(length);
    if (typeof object === "string") add(bytes(`${index + 1} 0 obj\n${object}\nendobj\n`));
    else {
      add(bytes(`${index + 1} 0 obj\n<< ${object.dict} /Length ${object.stream.length} >>\nstream\n`));
      add(object.stream);
      add(bytes("\nendstream\nendobj\n"));
    }
  });
  const start = length;
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  add(
    bytes(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${start}\n%%EOF\n`,
    ),
  );
  return join(parts);
}

const pdfDate = (date: Date) => `D:${date.toISOString().replace(/\D/g, "").slice(0, 14)}Z`;

export function renderPdf(document: ReportDocument): Uint8Array {
  const canvas = new Canvas();
  head(canvas, document);
  for (const block of document.blocks)
    (DRAW[block.kind] as (canvas: Canvas, block: DocumentBlock) => void)(canvas, block);
  canvas.pages.forEach((page, index) => {
    const style: Style = { size: 8, colour: MUTED };
    const last = canvas.pages.length;
    const count = winAnsi(`${document.page} ${index + 1} ${document.pageOf} ${last}`);
    const foot = new Canvas();
    foot.rule(PAGE.bottom + 10, 0.5, LINE);
    foot.text(PAGE.left, PAGE.bottom + 24, winAnsi(document.footer), style);
    foot.text(PAGE.right - textWidth(count, "regular", 8), PAGE.bottom + 24, count, style);
    page.push(...(foot.pages[0] as string[]));
  });

  const fonts = (Object.keys(FONT_KEYS) as Font[]).map(
    (font) => `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_NAMES[font]} /Encoding /WinAnsiEncoding >>`,
  );
  const pictures = [...canvas.pictures.keys()];
  const firstPicture = 4 + fonts.length;
  const firstPage = firstPicture + pictures.length;
  const pageObject = (index: number) => firstPage + index * 2;
  const named = (keys: readonly string[], first: number) =>
    keys.map((key, index) => `/${key} ${first + index} 0 R`).join(" ");
  const resources = `<< /Font << ${named(Object.values(FONT_KEYS), 4)} >> /XObject << ${named([...canvas.pictures.values()], firstPicture)} >> >>`;
  return assembled([
    "<< /Type /Catalog /Pages 2 0 R /Lang (id-ID) /ViewerPreferences << /DisplayDocTitle true >> >>",
    `<< /Type /Pages /Count ${canvas.pages.length} /Kids [${canvas.pages.map((_, index) => `${pageObject(index)} 0 R`).join(" ")}] >>`,
    `<< /Title ${literal(winAnsi(document.title))} /Author ${literal(winAnsi(document.agency))} /CreationDate (${pdfDate(document.madeAt)}) >>`,
    ...fonts,
    ...pictures.map((picture) => ({
      dict: `/Type /XObject /Subtype /Image /Width ${picture.width} /Height ${picture.height} /ColorSpace /${picture.colours === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode`,
      stream: picture.bytes,
    })),
    ...canvas.pages.flatMap((ops, index) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources ${resources} /Contents ${pageObject(index) + 1} 0 R >>`,
      { dict: "", stream: Uint8Array.from(ops.join("\n"), (character) => character.charCodeAt(0)) },
    ]),
  ]);
}
