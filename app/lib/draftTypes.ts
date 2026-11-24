import type { DraftBody } from "../../src/contract/draft";
import type { ErrorEnvelope } from "../../src/contract/errors";
import type { Texts } from "./text";
import type { Posted } from "./turnForm";

export type DraftPageData =
  | {
      readonly kind: "draft";
      readonly draft: DraftBody;
      readonly envelope: ErrorEnvelope | null;
      // Fresh for every render of a form, so a resubmit after a dropped connection replays.
      readonly turnKey: string;
      // A search inside the place card reads the draft again; that read is no resume.
      readonly searching: boolean;
      // The site's own address, for the tracking link in the QR code.
      readonly origin: string;
      readonly texts: Texts;
    }
  | { readonly kind: "refused"; readonly envelope: ErrorEnvelope; readonly texts: Texts };

export type DraftActionData = {
  readonly envelope: ErrorEnvelope | null;
  readonly posted: Posted;
  readonly networkLost: boolean;
};
