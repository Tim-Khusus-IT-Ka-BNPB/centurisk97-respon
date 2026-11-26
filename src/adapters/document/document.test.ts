import { describe, expect, test } from "vitest";
import type { DocumentBlock, Picture, ReportDocument } from "../../domain/document";
import { docxText, pdfLines, pdfText, unzipped } from "../../testing/documents";
import { PHOTO_BASE } from "../../testing/photoBase";
import { renderDocx } from "./docx";
import { renderPdf } from "./pdf";
import { textWidth, winAnsi, wrapped } from "./winAnsi";
import { zip } from "./zip";

const PHOTO: Picture = { bytes: PHOTO_BASE, width: 800, height: 600, colours: 3 };
const TALL: Picture = { bytes: PHOTO_BASE, width: 300, height: 900, colours: 1 };

const documentWith = (...blocks: DocumentBlock[]): ReportDocument => ({
  title: "Laporan LA-251126-01 versi 2",
  madeAt: new Date("2026-11-25T02:15:30.250Z"),
  emblem: PHOTO,
  emblemText: "Lambang",
  agency: "Badan Uji",
  heading: "Laporan (uji)",
  lead: "Disusun",
  ticketLabel: "Nomor tiket",
  ticketNumber: "LA-251126-01",
  version: "Versi 2",
  blocks,
  footer: "Kaki",
  page: "Halaman",
  pageOf: "dari",
});

const cells = (...texts: string[]) => texts.map((text) => ({ text, look: "value" as const }));
const ALL: DocumentBlock[] = [
  { kind: "band", tone: "alarm", text: "Darurat" },
  { kind: "band", tone: "notice", text: "Belum terverifikasi" },
  { kind: "band", tone: "plain", text: "Koreksi" },
  {
    kind: "figures",
    figures: [
      { label: "Meninggal", value: "2", unit: "orang", known: true },
      { label: "Hilang", value: "tidak ada", unit: null, known: true },
      { label: "Luka", value: "belum didata", unit: null, known: false },
    ],
  },
  { kind: "headline", text: "Bencana Banjir" },
  {
    kind: "numbered",
    items: [
      { label: "Lokasi", lines: ["Desa Contoh"] },
      { label: "Kronologi", lines: ["Air naik sejak dini hari dan ".repeat(12).trim()] },
      { label: "Dampak", lines: ["Korban jiwa.", "Pengungsi."] },
    ],
  },
  { kind: "section", text: "Rincian" },
  {
    kind: "table",
    widths: [0.5, 0.5],
    head: ["Isian", "Nilai"],
    rows: [
      "Korban",
      cells("Meninggal", "2 orang"),
      [
        { text: "Hilang", look: "label" },
        { text: "belum didata", look: "empty" },
      ],
      [
        { text: "Luka", look: "label" },
        { text: '"tiga <luka> & lain"', look: "words" },
      ],
    ],
  },
  { kind: "table", widths: [0.4, 0.6], head: null, rows: [cells("Peran", "Warga")] },
  { kind: "paragraph", text: "Catatan biasa", small: false },
  { kind: "paragraph", text: "Catatan kecil", small: true },
  {
    kind: "photos",
    photos: [
      { picture: PHOTO, caption: "Foto 1" },
      { picture: TALL, caption: "Foto 2" },
      { picture: PHOTO, caption: "Foto 3" },
    ],
  },
];

const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

// Every object a PDF's table points at is where it says, and every stream is as long as it says.
function checkPdf(bytes: Uint8Array): { readonly pages: number; readonly images: number } {
  const text = latin1(bytes);
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  expect(text.slice(start, start + 5)).toBe("xref\n");
  const offsets = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map(([, offset]) => Number(offset));
  offsets.forEach((offset, index) => {
    expect(text.slice(offset, offset + 12)).toContain(`${index + 1} 0 obj`);
  });
  for (const match of text.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
    const end = (match.index as number) + match[0].length + Number(match[1]);
    expect(text.slice(end, end + 10)).toBe("\nendstream");
  }
  return {
    pages: Number(/\/Type \/Pages \/Count (\d+)/.exec(text)?.[1]),
    images: [...text.matchAll(/\/Subtype \/Image/g)].length,
  };
}

// Every tag of an XML part is closed in order, so a reader opens it.
function checkXml(xml: string): void {
  const open: string[] = [];
  for (const [, close, name, self] of xml.matchAll(/<(\/?)([a-zA-Z][\w:]*)(?:"[^"]*"|[^">])*?(\/?)>/g)) {
    if (close) expect(open.pop()).toBe(name);
    else if (!self) open.push(name as string);
  }
  expect(open).toEqual([]);
}

describe("PDF", () => {
  test("holds every block's words, and is the same file each time", () => {
    const bytes = renderPdf(documentWith(...ALL));
    expect(checkPdf(bytes)).toEqual({ pages: 2, images: 2 });
    const text = pdfText(bytes);
    for (const words of [
      "BADAN UJI",
      "Laporan (uji)",
      "LA-251126-01",
      "Darurat",
      "tidak ada",
      "belum didata",
      "Air naik sejak dini hari dan Air naik",
      "a. Korban jiwa. b. Pengungsi.",
      "Korban Meninggal 2 orang",
      '"tiga <luka> & lain"',
      "Catatan kecil",
      "Foto 3",
      "Halaman 1 dari 2",
      "Halaman 2 dari 2",
    ])
      expect(text).toContain(words);
    expect(latin1(bytes)).toContain("/Title (Laporan LA-251126-01 versi 2)");
    expect(latin1(bytes)).toContain("/CreationDate (D:20261125021530Z)");
    expect(latin1(bytes)).toContain("/ColorSpace /DeviceGray");
    expect(renderPdf(documentWith(...ALL))).toEqual(bytes);
  });

  test("is tagged for a screen reader: parts in reading order, a photo said by its caption, lines and grounds skipped", () => {
    const text = latin1(renderPdf(documentWith(...ALL)));
    expect(text).toContain("/MarkInfo << /Marked true >> /StructTreeRoot");
    for (const role of ["Document", "H1", "H2", "P", "L", "LI", "Lbl", "LBody", "Table", "TR", "TH", "TD", "Figure"])
      expect(text).toContain(`/S /${role} /P `);
    expect(text).toMatch(/\/S \/Figure [^\n]*\/Alt \(Foto 1/);
    const parents = [...(/\/Nums \[(.*)\] >>/.exec(text)?.[1] ?? "").matchAll(/(\d+) \[([^\]]*)\]/g)];
    const pages = text.split("endstream").filter((part) => part.includes(" Tj"));
    expect(parents).toHaveLength(pages.length);
    pages.forEach((page, index) => {
      // Every piece is closed, numbered in order, and the structure names who owns each.
      expect(page.match(/ B[DM]C\n/g)?.length).toBe(page.match(/\nEMC/g)?.length);
      const pieces = [...page.matchAll(/<<\/MCID (\d+)>> BDC/g)].map(([, mcid]) => Number(mcid));
      expect(pieces).toEqual(pieces.map((_, n) => n));
      expect(parents[index]?.[2]?.match(/ 0 R/g)).toHaveLength(pieces.length);
      expect(page).toContain("/Artifact <</Type /Pagination>> BDC");
    });
  });

  test("a table longer than a page goes on under its own head, and a group's name stays with its rows", () => {
    const rows = Array.from({ length: 70 }, (_, n) => (n % 9 === 0 ? `Kelompok ${n}` : cells(`Isian ${n}`, "ya")));
    const bytes = renderPdf(documentWith({ kind: "table", widths: [0.5, 0.5], head: ["Isian", "Nilai"], rows }));
    const { pages } = checkPdf(bytes);
    expect(pages).toBeGreaterThan(1);
    const lines = pdfLines(bytes);
    expect(lines.filter((line) => line === "Nilai")).toHaveLength(pages);
    // A reader has the head once; on the next pages it is drawn for the eye only.
    expect(latin1(bytes).match(/\/Scope \/Column/g)).toHaveLength(2);
    for (let n = 0; n < 70; n += 1) expect(lines).toContain(n % 9 === 0 ? `Kelompok ${n}` : `Isian ${n}`);
  });

  test("the heading of the photos is on the page of the first of them, wherever the text before it ends", () => {
    for (let lines = 1; lines <= 60; lines += 1) {
      const bytes = renderPdf(
        documentWith(
          ...Array.from({ length: lines }, () => ({ kind: "paragraph", text: "Baris", small: false }) as const),
          { kind: "section", text: "Foto kejadian" },
          { kind: "photos", photos: [{ picture: { ...PHOTO }, caption: "Foto 1, dengan keterangan ".repeat(6) }] },
          { kind: "section", text: "Akhir" },
        ),
      );
      const page = latin1(bytes)
        .split("endstream")
        .find((part) => part.includes("(Foto kejadian) Tj"));
      expect(page, String(lines)).toContain("/P2 Do");
    }
  });

  test("long text, many points and many photos each turn the page", () => {
    const long = documentWith(
      { kind: "paragraph", text: "kata ".repeat(2400), small: false },
      { kind: "numbered", items: [{ label: "Dampak", lines: Array.from({ length: 60 }, (_, n) => `Baris ${n}`) }] },
      {
        kind: "photos",
        photos: Array.from({ length: 5 }, (_, n) => ({ picture: { ...PHOTO }, caption: `Foto ${n}` })),
      },
      { kind: "band", tone: "plain", text: "Akhir" },
    );
    const bytes = renderPdf(long);
    expect(checkPdf(bytes)).toEqual({ pages: expect.any(Number), images: 6 });
    expect(pdfText(bytes).match(/kata/g)).toHaveLength(2400);
    expect(pdfText(bytes)).toContain("Baris 59");
  });
});

describe("text in a PDF", () => {
  test("a character its fonts lack is written by its nearest letter, or as a question mark", () => {
    expect(winAnsi("Ujungé “banjir”\tdi\nRT 3")).toBe("Ujungé \x93banjir\x94 di RT 3");
    // A letter with a mark the encoding has no place for, marks on their own, and other scripts.
    expect(winAnsi("ṭanāh €5 ł 日本 \u{1f30a}️")).toBe("tanah \x805 ? ?? ?");
  });

  test("lines are never wider than asked; a word too long for one is broken inside", () => {
    expect(wrapped("", "regular", 10, 100)).toEqual([""]);
    const lines = wrapped(`satu dua tiga ${"x".repeat(60)} empat`, "bold", 10, 100);
    expect(lines.every((line) => textWidth(line, "bold", 10) <= 100)).toBe(true);
    expect(lines.join("").replace(/ /g, "")).toBe(`satuduatiga${"x".repeat(60)}empat`);
    expect(lines.length).toBeGreaterThan(4);
    expect(wrapped(`${"y".repeat(30)}`, "regular", 10, 100)).toHaveLength(2);
  });
});

describe("Word", () => {
  test("holds every block's words in parts a reader opens, and is the same file each time", async () => {
    const bytes = await renderDocx(documentWith(...ALL));
    const files = await unzipped(bytes);
    expect([...files.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "word/document.xml",
      "word/_rels/document.xml.rels",
      "word/styles.xml",
      "word/footer.xml",
      "word/media/image1.jpg",
      "word/media/image2.jpg",
      "word/media/image3.jpg",
      "word/media/image4.jpg",
    ]);
    for (const [name, part] of files)
      if (!name.endsWith(".jpg")) checkXml(new TextDecoder().decode(part).replace(/^<\?xml[^>]*>/, ""));
    expect(files.get("word/media/image2.jpg")).toEqual(PHOTO_BASE);
    const text = await docxText(bytes);
    for (const words of [
      "BADAN UJI",
      "LA-251126-01",
      "Darurat",
      "2 orang",
      "belum didata",
      "1. Lokasi: Desa Contoh",
      "a. Korban jiwa.",
      '"tiga <luka> & lain"',
      "Foto 3",
    ])
      expect(text).toContain(words);
    const main = new TextDecoder().decode(files.get("word/document.xml"));
    expect(main).toContain('descr="Foto 2"');
    expect(main).toContain('<w:pStyle w:val="Heading2"/>');
    expect(main).toContain("<w:tblHeader/>");
    expect(new TextDecoder().decode(files.get("docProps/core.xml"))).toContain("2026-11-25T02:15:30Z");
    expect(await renderDocx(documentWith(...ALL))).toEqual(bytes);
  });

  test("a character XML cannot hold is left out; any other is kept as it is", async () => {
    const bytes = await renderDocx(documentWith({ kind: "paragraph", text: "a\u0000b 日 \u{1f30a}", small: false }));
    expect(await docxText(bytes)).toContain("ab 日 \u{1f30a}");
  });
});

describe("zip", () => {
  test("files come back as they went in, under their names", async () => {
    const files = [
      { name: "BACA DULU é.txt", bytes: new TextEncoder().encode("isi ".repeat(40)), deflate: true },
      { name: "foto.jpg", bytes: PHOTO_BASE },
    ];
    const archive = await zip(files);
    const back = await unzipped(archive);
    expect([...back.entries()]).toEqual(files.map(({ name, bytes }) => [name, bytes]));
    expect(archive.length).toBeLessThan(PHOTO_BASE.length + 400);
    // The check number of the first file, as any zip tool works it out.
    const view = new DataView(archive.buffer);
    expect(view.getUint32(14, true)).toBe(0xba820162);
  });
});
