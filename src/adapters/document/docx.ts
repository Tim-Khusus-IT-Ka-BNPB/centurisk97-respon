import type { Cell, DocumentBlock, Picture, ReportDocument } from "../../domain/document";
import { utf8, type ZipFile, zip } from "./zip";

// The report as a Word file: a zip of WordprocessingML parts, written by hand. Lengths are in
// twentieths of a point, pictures in EMU.

const WIDTH = 9640;
const EMU_PER_TWIP = 635;
const FONT = "Arial";
const NAVY = "0B2545";
const INK = "16202E";
const MUTED = "55617A";
const LINE = "D5DCE6";
const TINT = "F1F4F8";
const BANDS = {
  alarm: { ground: "FBE4E1", ink: "9F1D13" },
  notice: { ground: "FDF1E3", ink: "8A3F06" },
  plain: { ground: TINT, ink: NAVY },
} as const;

// XML text: the characters that mean something to XML, and the ones it cannot hold, are written out or left out.
const xml = (text: string) =>
  text
    .replace(/[^\t\n\r -\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

type Look = {
  readonly size?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly colour?: string;
};

function run(text: string, { size = 10, bold = false, italic = false, colour = INK }: Look = {}): string {
  const half = Math.round(size * 2);
  return `<w:r><w:rPr>${bold ? "<w:b/>" : ""}${italic ? "<w:i/>" : ""}<w:color w:val="${colour}"/><w:sz w:val="${half}"/><w:szCs w:val="${half}"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
}

type Spacing = {
  readonly style?: string;
  readonly before?: number;
  readonly after?: number;
  readonly align?: "center" | "right";
  readonly indent?: number;
  readonly hanging?: number;
  readonly keepNext?: boolean;
  readonly rule?: number;
};

function para(runs: string, spacing: Spacing = {}): string {
  const { style, before = 0, after = 0, align, indent = 0, hanging = 0, keepNext = false, rule } = spacing;
  return `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${keepNext ? "<w:keepNext/>" : ""}${
    rule === undefined ? "" : `<w:pBdr><w:bottom w:val="single" w:sz="${rule}" w:space="2" w:color="${NAVY}"/></w:pBdr>`
  }<w:spacing w:before="${before}" w:after="${after}"/>${
    indent === 0 ? "" : `<w:ind w:left="${indent}" w:hanging="${hanging}"/>`
  }${align ? `<w:jc w:val="${align}"/>` : ""}</w:pPr>${runs}</w:p>`;
}

type Box = {
  readonly width: number;
  readonly span?: number;
  readonly ground?: string;
  readonly content: string;
};

const cell = ({ width, span, ground, content }: Box, margin: number) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span ? `<w:gridSpan w:val="${span}"/>` : ""}${
    ground ? `<w:shd w:val="clear" w:color="auto" w:fill="${ground}"/>` : ""
  }<w:tcMar><w:top w:w="${margin}" w:type="dxa"/><w:bottom w:w="${margin}" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr>${content}</w:tc>`;

type Grid = { readonly lined: boolean; readonly head?: boolean; readonly margin?: number };

function grid(
  widths: readonly number[],
  rows: readonly (readonly Box[])[],
  { lined, head = false, margin = 40 }: Grid,
): string {
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((side) =>
      lined && (side === "bottom" || side === "insideH")
        ? `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${LINE}"/>`
        : `<w:${side} w:val="nil"/>`,
    )
    .join("");
  const columns = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("");
  const body = rows
    .map(
      (boxes, index) =>
        `<w:tr><w:trPr><w:cantSplit/>${head && index === 0 ? "<w:tblHeader/>" : ""}</w:trPr>${boxes
          .map((box) => cell(box, margin))
          .join("")}</w:tr>`,
    )
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${WIDTH}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${columns}</w:tblGrid>${body}</w:tbl>`;
}

// Two tables with nothing between them are read as one.
const GAP = para("", { after: 60 });

// Media parts of the file, numbered as they are met.
class Media {
  readonly pictures: Picture[] = [];

  // A picture in the text, with the words a screen reader says for it.
  drawn(picture: Picture, width: number, height: number, words: string): string {
    this.pictures.push(picture);
    const id = this.pictures.length;
    const size = `cx="${Math.round(width * EMU_PER_TWIP)}" cy="${Math.round(height * EMU_PER_TWIP)}"`;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent ${size}/><wp:docPr id="${id}" name="${xml(words)}" descr="${xml(words)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext ${size}/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }
}

function head(document: ReportDocument, media: Media): string {
  const widths = [1150, 6010, 2480] as const;
  const title = [
    para(run(document.agency.toUpperCase(), { size: 8.5, bold: true, colour: MUTED })),
    para(run(document.heading, { size: 19, bold: true, colour: NAVY }), { style: "Title" }),
    para(run(document.lead, { size: 8.5, colour: MUTED })),
  ].join("");
  const white = (text: string, look: Look) => para(run(text, { ...look, colour: "FFFFFF" }), { align: "center" });
  const ticket = [
    white(document.ticketLabel, { size: 7.5 }),
    white(document.ticketNumber, { size: 12.5, bold: true }),
    white(document.version, { size: 8 }),
  ].join("");
  return (
    grid(
      widths,
      [
        [
          { width: widths[0], content: para(media.drawn(document.emblem, 960, 960, document.emblemText)) },
          { width: widths[1], content: title },
          { width: widths[2], ground: NAVY, content: ticket },
        ],
      ],
      { lined: false, margin: 60 },
    ) + para("", { after: 80, rule: 16 })
  );
}

const LOOKS: Readonly<Record<Cell["look"], Look>> = {
  label: { size: 9, colour: MUTED },
  value: { size: 9, bold: true },
  empty: { size: 9, colour: MUTED },
  words: { size: 9, italic: true, colour: MUTED },
};

function table(block: Extract<DocumentBlock, { kind: "table" }>): string {
  const widths = block.widths.map((share) => Math.round(share * WIDTH));
  const headRow =
    block.head === null
      ? []
      : [
          block.head.map((text, index) => ({
            width: widths[index] as number,
            content: para(run(text, { size: 8, bold: true, colour: MUTED })),
          })),
        ];
  let striped = true;
  const rows = block.rows.map((cells): Box[] => {
    if (typeof cells === "string") {
      striped = true;
      const content = para(run(cells, { size: 9, bold: true, colour: NAVY }), { before: 100, keepNext: true });
      return [{ width: WIDTH, span: widths.length, content }];
    }
    striped = !striped;
    return cells.map((one, index) => ({
      width: widths[index] as number,
      ...(striped ? { ground: TINT } : {}),
      content: para(run(one.text, LOOKS[one.look])),
    }));
  });
  return grid(widths, [...headRow, ...rows], { lined: true, head: block.head !== null }) + GAP;
}

function figures(block: Extract<DocumentBlock, { kind: "figures" }>): string {
  const width = Math.floor(WIDTH / block.figures.length);
  return (
    grid(
      block.figures.map(() => width),
      [
        block.figures.map((figure) => ({
          width,
          ground: TINT,
          content:
            para(
              figure.unit === null
                ? run(figure.value, { size: 11, bold: figure.known, colour: figure.known ? NAVY : MUTED })
                : run(figure.value, { size: 18, bold: true, colour: NAVY }) +
                    run(` ${figure.unit}`, { size: 8.5, colour: NAVY }),
              { align: "center" },
            ) + para(run(figure.label, { size: 8, colour: MUTED }), { align: "center" }),
        })),
      ],
      { lined: false, margin: 90 },
    ) + GAP
  );
}

function numbered(block: Extract<DocumentBlock, { kind: "numbered" }>): string {
  return block.items
    .map(({ label, lines }, index) => {
      const name = run(`${index + 1}.  ${label}: `, { bold: true });
      if (lines.length === 1)
        return para(name + run(lines[0] as string), { indent: 360, hanging: 360, before: 60, after: 20 });
      const points = lines.map((line, at) =>
        para(run(`${String.fromCharCode(97 + at)}.  ${line}`), { indent: 720, hanging: 300, before: 10 }),
      );
      return [para(name, { indent: 360, hanging: 360, before: 60, keepNext: true }), ...points].join("");
    })
    .join("");
}

function photos(block: Extract<DocumentBlock, { kind: "photos" }>, media: Media): string {
  const width = WIDTH / 2;
  const frame = { width: width - 260, height: (width - 260) * 0.75 };
  const boxes = block.photos.map(({ picture, caption }) => {
    const scale = Math.min(frame.width / picture.width, frame.height / picture.height);
    return {
      width,
      content:
        para(media.drawn(picture, picture.width * scale, picture.height * scale, caption), { align: "center" }) +
        para(run(caption, { size: 8, colour: MUTED }), { align: "center", after: 80 }),
    };
  });
  const rows: Box[][] = [];
  for (let at = 0; at < boxes.length; at += 2)
    rows.push([boxes[at] as Box, boxes[at + 1] ?? { width, content: para("") }]);
  return grid([width, width], rows, { lined: false }) + GAP;
}

function block(one: DocumentBlock, media: Media): string {
  switch (one.kind) {
    case "band": {
      const { ground, ink } = BANDS[one.tone];
      const content = para(run(one.text, { size: 9, bold: true, colour: ink }));
      return grid([WIDTH], [[{ width: WIDTH, ground, content }]], { lined: false, margin: 70 }) + GAP;
    }
    case "figures":
      return figures(one);
    case "headline":
      return para(run(one.text, { size: 12.5, bold: true, colour: NAVY }), { style: "Heading1", after: 60 });
    case "numbered":
      return numbered(one);
    case "section":
      return para(run(one.text, { size: 11.5, bold: true, colour: NAVY }), {
        style: "Heading2",
        before: 220,
        after: 60,
        keepNext: true,
        rule: 8,
      });
    case "paragraph":
      return para(run(one.text, one.small ? { size: 8, italic: true, colour: MUTED } : {}), { before: 60, after: 60 });
    case "table":
      return table(one);
    default:
      return photos(one, media);
  }
}

const HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE = "http://schemas.openxmlformats.org/package/2006";
const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml";

const relationships = (list: readonly (readonly [id: string, type: string, target: string])[]) =>
  `${HEADER}<Relationships xmlns="${PACKAGE}/relationships">${list
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
    .join("")}</Relationships>`;

const part = (name: string, type: string) => `<Override PartName="${name}" ContentType="${type}"/>`;

const style = (id: string, name: string, extra: string) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${extra}</w:style>`;

const STYLES = `${HEADER}<w:styles xmlns:w="${WORD}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}" w:eastAsia="${FONT}"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="id-ID"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${style("Title", "Title", "")}${style("Heading1", "heading 1", '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>')}${style("Heading2", "heading 2", '<w:pPr><w:outlineLvl w:val="1"/></w:pPr>')}</w:styles>`;

const field = (name: string) =>
  `<w:r><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> ${name} </w:instrText></w:r><w:r><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>`;

function footer(document: ReportDocument): string {
  const look: Look = { size: 8, colour: MUTED };
  return `${HEADER}<w:ftr xmlns:w="${WORD}">${para(
    run(`${document.footer}  |  ${document.page} `, look) +
      field("PAGE") +
      run(` ${document.pageOf} `, look) +
      field("NUMPAGES"),
    { align: "center" },
  )}</w:ftr>`;
}

export async function renderDocx(document: ReportDocument): Promise<Uint8Array> {
  const media = new Media();
  const body = head(document, media) + document.blocks.map((one) => block(one, media)).join("");
  const main = `${HEADER}<w:document xmlns:w="${WORD}" xmlns:r="${OFFICE}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="800" w:right="1133" w:bottom="1000" w:left="1133" w:header="400" w:footer="500" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const made = document.madeAt.toISOString().replace(/\.\d+/, "");
  const core = `${HEADER}<cp:coreProperties xmlns:cp="${PACKAGE}/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(document.title)}</dc:title><dc:creator>${xml(document.agency)}</dc:creator><dc:language>id-ID</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${made}</dcterms:created></cp:coreProperties>`;
  const types = `${HEADER}<Types xmlns="${PACKAGE}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/>${part("/word/document.xml", `${MIME}.document.main+xml`)}${part("/word/styles.xml", `${MIME}.styles+xml`)}${part("/word/footer.xml", `${MIME}.footer+xml`)}${part("/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml")}</Types>`;
  const files: ZipFile[] = [
    ["[Content_Types].xml", types],
    [
      "_rels/.rels",
      relationships([
        ["document", `${OFFICE}/officeDocument`, "word/document.xml"],
        ["core", `${PACKAGE}/relationships/metadata/core-properties`, "docProps/core.xml"],
      ]),
    ],
    ["docProps/core.xml", core],
    ["word/document.xml", main],
    [
      "word/_rels/document.xml.rels",
      relationships([
        ["styles", `${OFFICE}/styles`, "styles.xml"],
        ["footer", `${OFFICE}/footer`, "footer.xml"],
        ...media.pictures.map(
          (_, index) => [`image${index + 1}`, `${OFFICE}/image`, `media/image${index + 1}.jpg`] as const,
        ),
      ]),
    ],
    ["word/styles.xml", STYLES],
    ["word/footer.xml", footer(document)],
  ].map(([name, text]) => ({ name: name as string, bytes: utf8(text as string), deflate: true }));
  return zip([
    ...files,
    ...media.pictures.map((picture, index) => ({ name: `word/media/image${index + 1}.jpg`, bytes: picture.bytes })),
  ]);
}
