import type { Card } from "../../src/contract/card";
import type { DraftBody } from "../../src/contract/draft";

// A sent or cancelled draft takes no more answers: no message box, no live card form.
export const isFinalCard = (card: Card) => card.kind === "sent" || card.kind === "cancelled";

// Which page-level notices of the read to draw. A read after a refused post or inside a search
// is no resume, so it shows neither the resumed notice nor its 112 line; the summary draws its
// own 112 panel, and a closed draft draws none.
export function pageNotices(notices: DraftBody["notices"], card: Card, quiet: boolean) {
  const has = (kind: DraftBody["notices"][number]["kind"]) => !quiet && notices.some((notice) => notice.kind === kind);
  const open = !isFinalCard(card);
  return { resumed: open && has("resumed"), lifeLine: open && card.kind !== "summary" && has("lifeLine") };
}

type RefusedWords = { readonly title: string | null; readonly body: string | null; readonly action: string };
const NEW_REPORT = "card.expired.new";

// The words of a draft that cannot be opened. Only the owner is told it expired; anyone else is
// told it was not found, and the page carries no other refusal's words.
export function refusedWords(code: string): RefusedWords {
  if (code === "draft.expired") return { title: "card.expired.title", body: "card.expired.body", action: NEW_REPORT };
  if (code === "auth.signInFirst")
    return { title: "error.auth.signInFirst", body: "error.auth.signInFirst.hint", action: NEW_REPORT };
  if (code === "draft.notFound")
    return { title: "error.draft.notFound.title", body: "error.draft.notFound.body", action: NEW_REPORT };
  if (code === "report.notFound")
    return { title: "error.draft.notFound.title", body: "error.report.notFound", action: NEW_REPORT };
  return { title: null, body: null, action: NEW_REPORT };
}
