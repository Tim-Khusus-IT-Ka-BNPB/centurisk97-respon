import type { ApiCall } from "../../src/api/bridge";
import { draftPageAction } from "../../src/api/pageActions";
import { draftPageLoad } from "../../src/api/pageLoaders";
import { refusedWords } from "./cards";
import type { DraftActionData, DraftPageData } from "./draftTypes";
import { PAGE_TEXTS, pickTexts } from "./texts.server";
import { postedOf, toTurnForm } from "./turnForm";

export async function loadDraftPage(
  draftId: string,
  url: URL,
  api: ApiCall,
  newKey: () => string,
): Promise<{ readonly status: number; readonly data: DraftPageData }> {
  const load = await draftPageLoad(draftId, url.searchParams, api);
  if (load.kind === "refused")
    return {
      status: load.status,
      data: {
        kind: "refused",
        envelope: load.envelope,
        texts: pickTexts(PAGE_TEXTS.refused, [load.envelope.error.copyKey, refusedWords(load.envelope.error.code)]),
      },
    };
  return {
    status: load.status,
    data: {
      kind: "draft",
      draft: load.draft,
      envelope: load.envelope,
      turnKey: newKey(),
      searching: url.searchParams.has("q") || url.searchParams.has("area"),
      texts: pickTexts(PAGE_TEXTS.draft, load.draft),
    },
  };
}

export type DraftActed =
  | { readonly kind: "redirect"; readonly location: string; readonly headers: Headers }
  | { readonly kind: "render"; readonly status: number; readonly data: DraftActionData };

// A turn or a send posted from a form. Inputs are named by field id; the redirect keeps the
// address free of a fragment, so the next card's autofocus works with no script.
export async function actOnDraft(draftId: string, form: FormData, api: ApiCall): Promise<DraftActed> {
  const result = await draftPageAction(draftId, toTurnForm(form), api);
  if (result.kind === "redirect") {
    const headers = new Headers(result.headers);
    // With script the step replaces the history entry: chat steps add no browser history.
    headers.set("X-Remix-Replace", "true");
    return { kind: "redirect", location: result.location, headers };
  }
  return {
    kind: "render",
    status: result.status,
    data: { envelope: result.envelope, posted: postedOf(form), networkLost: false },
  };
}
