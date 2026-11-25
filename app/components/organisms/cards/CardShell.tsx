import { createContext, type ReactNode, useContext } from "react";
import { Form } from "react-router";
import type { Card } from "../../../../src/contract/card";
import type { DraftBody } from "../../../../src/contract/draft";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { cardProblem, firstInvalid } from "../../../lib/envelope";
import { useFocusOnChange, useMountFocus } from "../../../lib/hooks";
import { breakAfterSlash } from "../../../lib/slash";
import { useText } from "../../../lib/text";
import { type Posted, postedValue } from "../../../lib/turnForm";
import { LifeLine, Notice } from "../../molecules/Notice";

// What every card of the draft page reads: the draft, this render's turn key, and the last refusal.
export type DraftView = {
  readonly draft: DraftBody;
  readonly turnKey: string;
  readonly envelope: ErrorEnvelope | null;
  // The values of a refused post, drawn again so nothing typed is lost.
  readonly posted: Posted | null;
  readonly networkLost: boolean;
  // The 112 line the read carries, drawn inside the live card under its heading so it is in view.
  readonly lifeLine: boolean;
  // The site's own address, for absolute links such as the tracking link's QR code.
  readonly origin: string;
};

export const DraftContext = createContext<DraftView | null>(null);

export function useDraftView(): DraftView {
  const view = useContext(DraftContext);
  if (view === null) throw new Error("A card is drawn outside its draft page");
  return view;
}

export const headingIdOf = (card: Card) => `card-${card.cardId}`;

export function usePostedValue(name: string, fallback: string | number | null): string {
  return postedValue(useDraftView().posted, name, fallback);
}

export function usePostedOptions(): readonly string[] | null {
  const { posted } = useDraftView();
  return posted?.optionIds ?? null;
}

// The field that takes focus: the first the server refused, in the order the card draws them.
export function useFocusField(order: readonly string[]): string | null {
  const { envelope } = useDraftView();
  return firstInvalid(envelope, order);
}

// The hidden part of every answer: which draft revision and card it answers, and the turn key
// that makes a retry safe.
export function TurnForm({
  children,
  kind = "answer",
  className,
}: {
  readonly children: ReactNode;
  readonly kind?: string;
  readonly className?: string;
}) {
  const { draft, turnKey } = useDraftView();
  return (
    <Form method="post" replace preventScrollReset className={className ?? "flex min-w-0 flex-col gap-4"}>
      <input type="hidden" name="action" value="turn" />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="cardId" value={draft.card.cardId} />
      <input type="hidden" name="revision" value={draft.revision} />
      <input type="hidden" name="turnKey" value={turnKey} />
      {children}
    </Form>
  );
}

type ShellProps = {
  readonly card: Card;
  readonly title: string;
  readonly prompt?: string | null;
  readonly progress?: string | null;
  // The refused field that takes focus instead of the heading, if any.
  readonly focusId: string | null;
  // True when the card draws its own refusal notice where it belongs (the summary, above "Kirim").
  readonly ownProblem?: boolean;
  readonly children: ReactNode;
};

const REFUSALS = new Set(["draft.nothingToUndo", "draft.backLimit"]);

// One live card: a section named by its heading, which takes focus when the card arrives.
export function CardShell({ card, title, prompt, progress, focusId, ownProblem = false, children }: ShellProps) {
  const t = useText();
  const { draft, envelope, networkLost, lifeLine } = useDraftView();
  const problem = ownProblem ? null : cardProblem(envelope);
  // Nothing failed when there is nothing to undo: it is told as a refusal, not an error.
  const refusal = envelope !== null && REFUSALS.has(envelope.error.code);
  const warnings = draft.notices.filter((notice) => notice.kind === "danger");
  // A refusal redrawn with script moves focus as the server's autofocus does with none.
  useFocusOnChange(focusId, envelope);
  // Any refusal keeps focus where it belongs: the refused field, the box, or the pressed control.
  const headingFocus = focusId === null && envelope === null && !networkLost;
  const heading = useMountFocus<HTMLHeadingElement>(headingFocus);
  return (
    <section
      aria-labelledby={headingIdOf(card)}
      data-card-kind={card.kind}
      data-card-id={card.cardId}
      className="@container flex min-w-0 animate-settle flex-col gap-4 card-surface p-4 md:p-6"
    >
      {problem ? <Notice kind={refusal ? "refusal" : "error"}>{t(problem.copyKey, problem.params)}</Notice> : null}
      {networkLost ? <Notice kind="error">{t("error.network.lost")}</Notice> : null}
      <div className="flex flex-col gap-2">
        <h2
          id={headingIdOf(card)}
          tabIndex={-1}
          ref={heading}
          autoFocus={headingFocus}
          className="text-page font-bold text-balance"
        >
          {breakAfterSlash(title)}
        </h2>
        {lifeLine ? <LifeLine /> : null}
        {progress ? <p className="text-meta text-muted tabular-nums">{progress}</p> : null}
        {prompt ? <p className="text-body text-muted">{breakAfterSlash(prompt)}</p> : null}
      </div>
      {warnings.map((notice) => (
        <Notice key={notice.copyKey} kind="danger">
          {t(notice.copyKey, notice.params)}
        </Notice>
      ))}
      {children}
    </section>
  );
}
