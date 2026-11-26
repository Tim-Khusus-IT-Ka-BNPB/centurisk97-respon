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

// The structure a screen reader walks (a tagged PDF): a part's role, its kids in reading order
// (marked content on a page, or parts of its own), a picture's words and a table cell's scope.
type Kid = { readonly page: number; readonly mcid: number } | Part;
type Part = { readonly role: string; readonly kids: Kid[]; readonly alt?: string; readonly attributes?: string };

class Canvas {
  readonly pages: string[][] = [];
  readonly pictures = new Map<Picture, string>();
  // Per page, the part each marked content belongs to, by its number.
  readonly owners: Part[][] = [];
  readonly root: Part = { role: "Document", kids: [] };
  private readonly open: Part[] = [this.root];
  private marked: Part | "artifact" | null = null;
  y = 0;

  // A canvas that is not tagged draws what a page repeats, wrapped as one artifact by its caller.
  constructor(readonly tagged = true) {
    this.turn();
  }

  turn(): void {
    this.close();
    this.pages.push([]);
    this.owners.push([]);
    this.y = PAGE.top;
  }

  // Starts a new page when what comes next does not fit on this one.
  room(height: number): void {
    if (this.y + height > PAGE.bottom) this.turn();
  }

  // What is drawn from here to its end belongs to a part of this role.
  part(role: string, draw: () => void, extra: { alt?: string; attributes?: string } = {}): void {
    const part: Part = { role, kids: [], ...extra };
    (this.open.at(-1) as Part).kids.push(part);
    this.open.push(part);
    draw();
    this.open.pop();
  }

  private close(): void {
    if (this.marked !== null) this.raw("EMC");
    this.marked = null;
  }

  private raw(op: string): void {
    (this.pages.at(-1) as string[]).push(op);
  }

  // Words and pictures, in the part open; lines and grounds, as artifacts a reader skips.
  put(op: string, artifact = false): void {
    const owner = artifact ? "artifact" : (this.open.at(-1) as Part);
    if (this.tagged && this.marked !== owner) {
      this.close();
      if (owner === "artifact") this.raw("/Artifact BMC");
      else {
        const page = this.pages.length - 1;
        const mcid = (this.owners[page] as Part[]).push(owner) - 1;
        owner.kids.push({ page, mcid });
        this.raw(`/${owner.role} <</MCID ${mcid}>> BDC`);
      }
      this.marked = owner;
    }
    this.raw(op);
  }

  finish(): void {
    this.close();
  }

  rect(x: number, y: number, width: number, height: number, colour: Colour): void {
    this.put(`${paint(colour)} rg ${num(x)} ${num(PAGE.height - y - height)} ${num(width)} ${num(height)} re f`, true);
  }

  rule(y: number, weight: number, colour: Colour): void {
    this.rect(PAGE.left, y, WIDTH, weight, colour);
  }

  // One line of encoded text, its baseline at y.
  text(x: number, y: number, encoded: string, { font = "regular", size, colour = INK }: Style, artifact = false): void {
    this.put(
      `BT /${FONT_KEYS[font]} ${num(size)} Tf ${paint(colour)} rg ${num(x)} ${num(PAGE.height - y)} Td ${literal(encoded)} Tj ET`,
      artifact,
    );
  }

  centred(middle: number, y: number, encoded: string, style: Style): void {
    this.text(middle - textWidth(encoded, style.font ?? "regular", style.size) / 2, y, encoded, style);
  }

  picture(picture: Picture, x: number, y: number, width: number, height: number, artifact = false): void {
    let name = this.pictures.get(picture);
    if (name === undefined) {
      name = `P${this.pictures.size + 1}`;
      this.pictures.set(picture, name);
    }
    this.put(
      `q ${num(width)} 0 0 ${num(height)} ${num(x)} ${num(PAGE.height - y - height)} cm /${name} Do Q`,
      artifact,
    );
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
  // The emblem stands beside the agency's name, so a reader skips it.
  canvas.picture(document.emblem, PAGE.left, top, 48, 48, true);
  canvas.part("P", () =>
    canvas.text(PAGE.left + 60, top + 13, winAnsi(document.agency.toUpperCase()), {
      font: "bold",
      size: 8.5,
      colour: MUTED,
    }),
  );
  canvas.part("H1", () =>
    canvas.text(PAGE.left + 60, top + 34, winAnsi(document.heading), { font: "bold", size: 19, colour: NAVY }),
  );
  canvas.part("P", () => canvas.text(PAGE.left + 60, top + 47, winAnsi(document.lead), { size: 8.5, colour: MUTED }));
  canvas.rect(PAGE.right - box, top, box, 50, NAVY);
  const middle = PAGE.right - box / 2;
  canvas.part("P", () => {
    canvas.centred(middle, top + 14, winAnsi(document.ticketLabel), { size: 7.5, colour: WHITE });
    canvas.centred(middle, top + 30, winAnsi(document.ticketNumber), { font: "bold", size: 12.5, colour: WHITE });
    canvas.centred(middle, top + 43, winAnsi(document.version), { size: 8, colour: WHITE });
  });
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
  canvas.part("P", () => canvas.lines(PAGE.left + 10, canvas.y + 5, lines, style));
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
    // Read as "Meninggal, 2 orang".
    canvas.part("P", () => {
      canvas.centred(middle, canvas.y + 41, winAnsi(figure.label), { size: 8, colour: MUTED });
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
    });
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
  canvas.part("L", () =>
    block.items.forEach(({ label, lines }, index) => {
      const [only, ...more] = lines;
      const name = winAnsi(`${label}: `);
      canvas.room(30);
      const y = canvas.y + 10;
      canvas.part("LI", () => {
        canvas.part("Lbl", () => canvas.text(PAGE.left, y, `${index + 1}.`, { font: "bold", size: 10 }));
        canvas.part("LBody", () => {
          canvas.text(PAGE.left + 18, y, name, { font: "bold", size: 10 });
          const after = textWidth(name, "bold", 10);
          if (more.length === 0) {
            // The first line starts beside its label, the rest under it.
            const [first = "", ...rest] = wrapped(winAnsi(only as string), "regular", 10, WIDTH - 18 - after);
            canvas.text(PAGE.left + 18 + after, y, first, BODY);
            canvas.y += 13.5;
            if (rest.length > 0) paragraph(canvas, rest.join(" "), BODY, 18);
            return;
          }
          canvas.y += 13.5;
          canvas.part("L", () =>
            lines.forEach((line, at) => {
              canvas.room(13.5);
              canvas.part("LI", () => {
                canvas.part("Lbl", () =>
                  canvas.text(PAGE.left + 18, canvas.y + 10, `${String.fromCharCode(97 + at)}.`, BODY),
                );
                canvas.part("LBody", () => paragraph(canvas, line, BODY, 34));
              });
            }),
          );
        });
      });
      canvas.y += 3;
    }),
  );
}

type PhotosBlock = Extract<DocumentBlock, { kind: "photos" }>;

const PHOTO_GAP = 13;
const PHOTO_WIDTH = (WIDTH - PHOTO_GAP) / 2;
const PHOTO_HEIGHT = PHOTO_WIDTH * 0.75;

// The two photos side by side from there on, with the lines of their captions.
function photoRow(block: PhotosBlock, at: number) {
  const row = block.photos.slice(at, at + 2).map((photo) => ({
    ...photo,
    lines: wrapped(winAnsi(photo.caption), "regular", 8, PHOTO_WIDTH),
  }));
  return { row, caption: Math.max(...row.map((photo) => photo.lines.length)) * 8 * 1.35 };
}

const HEADING_HEIGHT = 10 + 11.5 * 1.35 + 5;

function section(canvas: Canvas, text: string, next: DocumentBlock | undefined): void {
  // A heading never stands alone at the foot of a page, and photos are tall.
  canvas.room(next?.kind === "photos" ? HEADING_HEIGHT + PHOTO_HEIGHT + photoRow(next, 0).caption + 14 : 58);
  canvas.y += 10;
  canvas.part("H2", () => {
    canvas.y = canvas.lines(PAGE.left, canvas.y, [winAnsi(text)], { font: "bold", size: 11.5, colour: NAVY });
  });
  canvas.rule(canvas.y + 1, 1, NAVY);
  canvas.y += 5;
}

// A column's head cell; a group's name heads its row across every column.
const COLUMN_HEAD = "/A << /O /Table /Scope /Column >>";
const groupHead = (columns: number) => `/A << /O /Table /Scope /Row /ColSpan ${columns} >>`;

function table(canvas: Canvas, block: Extract<DocumentBlock, { kind: "table" }>): void {
  const size = 9;
  const pad = 6;
  const widths = block.widths.map((share) => share * WIDTH);
  const starts = widths.map((_, index) => PAGE.left + widths.slice(0, index).reduce((sum, one) => sum + one, 0));
  // The head again on a new page is drawn for the eye; a reader has it once.
  const headRow = (again: boolean) => {
    const head = block.head;
    if (head === null) return;
    const cell = (text: string, index: number) =>
      canvas.text(
        (starts[index] as number) + pad,
        canvas.y + 11,
        winAnsi(text),
        { font: "bold", size: 8, colour: MUTED },
        again,
      );
    if (again) head.forEach(cell);
    else
      canvas.part("TR", () =>
        head.forEach((text, index) => {
          canvas.part("TH", () => cell(text, index), { attributes: COLUMN_HEAD });
        }),
      );
    canvas.y += 16;
    canvas.rule(canvas.y, 0.75, LINE);
  };
  canvas.y += 3;
  canvas.room(40);
  canvas.part("Table", () => {
    headRow(false);
    let striped = false;
    for (const cells of block.rows) {
      if (typeof cells === "string") {
        // The name of a group stays with its first row.
        if (canvas.y + 44 > PAGE.bottom) {
          canvas.turn();
          headRow(true);
        }
        canvas.part("TR", () =>
          canvas.part(
            "TH",
            () => canvas.text(PAGE.left + pad, canvas.y + 19, winAnsi(cells), { font: "bold", size: 9, colour: NAVY }),
            { attributes: groupHead(widths.length) },
          ),
        );
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
        headRow(true);
      }
      if (striped) canvas.rect(PAGE.left, canvas.y, WIDTH, height, TINT);
      striped = !striped;
      canvas.part("TR", () =>
        columns.forEach(({ look, lines }, index) => {
          canvas.part("TD", () =>
            canvas.lines((starts[index] as number) + pad, canvas.y + 3, lines, { ...look, size }),
          );
        }),
      );
      canvas.y += height;
      canvas.rule(canvas.y, 0.5, LINE);
    }
  });
  canvas.y += 2;
}

function photos(canvas: Canvas, block: PhotosBlock): void {
  const width = PHOTO_WIDTH;
  const height = PHOTO_HEIGHT;
  for (let at = 0; at < block.photos.length; at += 2) {
    const { row, caption } = photoRow(block, at);
    canvas.room(height + caption + 14);
    canvas.y += 4;
    row.forEach(({ picture, lines, caption: words }, index) => {
      const x = PAGE.left + index * (width + PHOTO_GAP);
      // Whole, in the middle of its frame, never cropped.
      const scale = Math.min(width / picture.width, height / picture.height);
      const drawn = { width: picture.width * scale, height: picture.height * scale };
      canvas.rect(x, canvas.y, width, height, TINT);
      // A reader says the caption, its badges in words, in place of the photo.
      canvas.part(
        "Figure",
        () => {
          canvas.picture(
            picture,
            x + (width - drawn.width) / 2,
            canvas.y + (height - drawn.height) / 2,
            drawn.width,
            drawn.height,
          );
          canvas.lines(x, canvas.y + height + 3, lines, { size: 8, colour: MUTED });
        },
        { alt: words },
      );
    });
    canvas.y += height + caption + 10;
  }
}

const DRAW: {
  readonly [K in DocumentBlock["kind"]]: (
    canvas: Canvas,
    block: Extract<DocumentBlock, { kind: K }>,
    next: DocumentBlock | undefined,
  ) => void;
} = {
  band,
  figures,
  headline: (canvas, block) => {
    canvas.y += 12;
    canvas.part("P", () => paragraph(canvas, block.text, HEADLINE));
    canvas.y += 4;
  },
  numbered,
  section: (canvas, block, next) => section(canvas, block.text, next),
  paragraph: (canvas, block) => {
    canvas.y += 3;
    canvas.part("P", () => paragraph(canvas, block.text, block.small ? SMALL : BODY));
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

// The parts in reading order, each after the one it sits in.
function partsOf(part: Part): Part[] {
  return [part, ...part.kids.flatMap((kid) => ("role" in kid ? partsOf(kid) : []))];
}

export function renderPdf(document: ReportDocument): Uint8Array {
  const canvas = new Canvas();
  head(canvas, document);
  document.blocks.forEach((block, index) => {
    const draw = DRAW[block.kind] as (canvas: Canvas, block: DocumentBlock, next: DocumentBlock | undefined) => void;
    draw(canvas, block, document.blocks[index + 1]);
  });
  canvas.finish();
  canvas.pages.forEach((page, index) => {
    const style: Style = { size: 8, colour: MUTED };
    const last = canvas.pages.length;
    const count = winAnsi(`${document.page} ${index + 1} ${document.pageOf} ${last}`);
    const foot = new Canvas(false);
    foot.rule(PAGE.bottom + 10, 0.5, LINE);
    foot.text(PAGE.left, PAGE.bottom + 24, winAnsi(document.footer), style);
    foot.text(PAGE.right - textWidth(count, "regular", 8), PAGE.bottom + 24, count, style);
    page.push("/Artifact <</Type /Pagination>> BDC", ...(foot.pages[0] as string[]), "EMC");
  });

  const fonts = (Object.keys(FONT_KEYS) as Font[]).map(
    (font) => `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_NAMES[font]} /Encoding /WinAnsiEncoding >>`,
  );
  const pictures = [...canvas.pictures.keys()];
  const firstPicture = 4 + fonts.length;
  const firstPage = firstPicture + pictures.length;
  const pageObject = (index: number) => firstPage + index * 2;
  const treeRoot = firstPage + canvas.pages.length * 2;
  const parts = partsOf(canvas.root);
  const partObject = new Map(parts.map((part, index) => [part, treeRoot + 2 + index]));
  const ref = (part: Part) => `${partObject.get(part)} 0 R`;
  const parentOf = new Map(parts.flatMap((part) => part.kids.flatMap((kid) => ("role" in kid ? [[kid, part]] : []))));
  const named = (keys: readonly string[], first: number) =>
    keys.map((key, index) => `/${key} ${first + index} 0 R`).join(" ");
  const resources = `<< /Font << ${named(Object.values(FONT_KEYS), 4)} >> /XObject << ${named([...canvas.pictures.values()], firstPicture)} >> >>`;
  const kid = (one: Kid) =>
    "role" in one ? ref(one) : `<< /Type /MCR /Pg ${pageObject(one.page)} 0 R /MCID ${one.mcid} >>`;
  return assembled([
    `<< /Type /Catalog /Pages 2 0 R /Lang (id-ID) /MarkInfo << /Marked true >> /StructTreeRoot ${treeRoot} 0 R /ViewerPreferences << /DisplayDocTitle true >> >>`,
    `<< /Type /Pages /Count ${canvas.pages.length} /Kids [${canvas.pages.map((_, index) => `${pageObject(index)} 0 R`).join(" ")}] >>`,
    `<< /Title ${literal(winAnsi(document.title))} /Author ${literal(winAnsi(document.agency))} /CreationDate (${pdfDate(document.madeAt)}) >>`,
    ...fonts,
    ...pictures.map((picture) => ({
      dict: `/Type /XObject /Subtype /Image /Width ${picture.width} /Height ${picture.height} /ColorSpace /${picture.colours === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode`,
      stream: picture.bytes,
    })),
    ...canvas.pages.flatMap((ops, index) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources ${resources} /Contents ${pageObject(index) + 1} 0 R /StructParents ${index} /Tabs /S >>`,
      { dict: "", stream: Uint8Array.from(ops.join("\n"), (character) => character.charCodeAt(0)) },
    ]),
    `<< /Type /StructTreeRoot /K ${ref(canvas.root)} /ParentTree ${treeRoot + 1} 0 R /ParentTreeNextKey ${canvas.pages.length} >>`,
    `<< /Nums [${canvas.owners.map((owners, index) => `${index} [${owners.map(ref).join(" ")}]`).join(" ")}] >>`,
    ...parts.map((part) => {
      const parent = parentOf.get(part);
      const alt = part.alt === undefined ? "" : ` /Alt ${literal(winAnsi(part.alt))}`;
      return `<< /Type /StructElem /S /${part.role} /P ${parent === undefined ? `${treeRoot} 0 R` : ref(parent)} /K [${part.kids.map(kid).join(" ")}]${alt}${part.attributes === undefined ? "" : ` ${part.attributes}`} >>`;
    }),
  ]);
}
