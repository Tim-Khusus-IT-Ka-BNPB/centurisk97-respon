// A report as a document: what it holds and in which order, for the writers of each file format.
// The words are already chosen; a writer only lays them out.

export const DOCUMENT_FORMATS = ["pdf", "docx"] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

// A JPEG as it is stored, with its size in pixels and how many colour parts it has.
export type Picture = {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly colours: 1 | 3;
};

export type Cell = {
  readonly text: string;
  readonly look: "label" | "value" | "empty" | "words";
};

// A row of cells, or the name of the rows under it.
type Row = readonly Cell[] | string;

export type DocumentBlock =
  | { readonly kind: "band"; readonly tone: "alarm" | "notice" | "plain"; readonly text: string }
  // A figure not known or explicitly none has words in place of a number.
  | {
      readonly kind: "figures";
      readonly figures: readonly {
        readonly label: string;
        readonly value: string;
        readonly unit: string | null;
        readonly known: boolean;
      }[];
    }
  | { readonly kind: "headline"; readonly text: string }
  | {
      readonly kind: "numbered";
      readonly items: readonly { readonly label: string; readonly lines: readonly string[] }[];
    }
  | { readonly kind: "section"; readonly text: string }
  | { readonly kind: "paragraph"; readonly text: string; readonly small: boolean }
  | {
      readonly kind: "table";
      // Shares of the width, which add up to 1.
      readonly widths: readonly number[];
      readonly head: readonly string[] | null;
      readonly rows: readonly Row[];
    }
  | { readonly kind: "photos"; readonly photos: readonly { readonly picture: Picture; readonly caption: string }[] };

export type ReportDocument = {
  // The file's own title, and the name it is saved under.
  readonly title: string;
  readonly madeAt: Date;
  readonly emblem: Picture;
  readonly emblemText: string;
  readonly agency: string;
  readonly heading: string;
  readonly lead: string;
  readonly ticketLabel: string;
  readonly ticketNumber: string;
  readonly version: string;
  readonly blocks: readonly DocumentBlock[];
  readonly footer: string;
  readonly page: string;
  readonly pageOf: string;
};
