import type { Texts } from "../../src/copy/text";
import type { Instant } from "../../src/copy/time";
import type { MissingStatus } from "../../src/domain/missingPerson";

export type MissingMine = {
  readonly id: string;
  readonly name: string | null;
  readonly status: MissingStatus;
  readonly villageName: string;
  readonly createdAt: string;
};

export type MissingVillage = {
  readonly code: string;
  readonly name: string;
  readonly districtName: string;
  readonly regencyName: string;
};

export type MissingSearch =
  | { readonly kind: "start" | "short" | "none" | "unavailable" }
  | { readonly kind: "results"; readonly villages: readonly MissingVillage[] };

export type MissingLoad =
  | { readonly kind: "whoFirst"; readonly texts: Texts }
  | {
      readonly kind: "form";
      readonly texts: Texts;
      readonly query: string;
      readonly search: MissingSearch;
      readonly mine: readonly MissingMine[];
      readonly sent: boolean;
    };

type Place = { readonly villageName: string; readonly districtName: string; readonly regencyName: string };
type Stamp = Instant;

// One missing person as the desk reads it; names, numbers and photo are gone once anonymised.
export type DeskMissing = {
  readonly id: string;
  readonly status: MissingStatus;
  readonly place: Place;
  readonly name: string | null;
  readonly nickname: string | null;
  readonly relation: string;
  readonly sex: string;
  readonly age: number | null;
  readonly clothes: string | null;
  readonly marks: string | null;
  readonly lastSeen: { readonly date: string; readonly time: string | null; readonly zone: string };
  readonly personNumber: string | null;
  readonly contactNumber: string | null;
  readonly waitPlace: string | null;
  readonly reporterName: string | null;
  readonly hasPhoto: boolean;
  readonly createdAt: Stamp;
};

export type DeskMissingOne = DeskMissing & {
  readonly history: readonly {
    readonly status: MissingStatus;
    readonly note: string | null;
    readonly actor: string | null;
    readonly at: Stamp;
  }[];
};
