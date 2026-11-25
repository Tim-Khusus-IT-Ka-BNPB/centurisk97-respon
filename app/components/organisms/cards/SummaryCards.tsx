import type { ReactNode } from "react";
import { Form, Link } from "react-router";
import type { Card } from "../../../../src/contract/card";
import { cardProblem } from "../../../lib/envelope";
import { useBusy, useMountFocus } from "../../../lib/hooks";
import { hazardOf, type RowView, rowView } from "../../../lib/summary";
import { useText } from "../../../lib/text";
import { clockTime, longDate } from "../../../lib/time";
import { Button, buttonStyles } from "../../atoms/Button";
import { Icon } from "../../atoms/Icon";
import type { IconName } from "../../atoms/icons";
import { LifeLine, Notice } from "../../molecules/Notice";
import { CardShell, headingIdOf, TurnForm, useDraftView } from "./CardShell";

type SummaryCard = Extract<Card, { kind: "summary" }>;

const CHIPS: Readonly<Record<"confirmedUnknown" | "notYetKnown", { icon: IconName; look: string }>> = {
  confirmedUnknown: { icon: "circleHelp", look: "border-solid text-ink" },
  notYetKnown: { icon: "circleDashed", look: "border-dashed text-muted" },
};

// The three empty states differ by word and by shape, never by colour alone.
export function StateMark({ state }: { readonly state: "none" | "confirmedUnknown" | "notYetKnown" }) {
  const t = useText();
  if (state === "none")
    return (
      <span className="inline-flex items-center gap-1">
        <Icon name="minus" className="size-4" />
        {t("state.none")}
      </span>
    );
  const chip = CHIPS[state];
  return (
    <span className={`inline-flex items-center gap-1 rounded-chip border border-control px-1.5 text-meta ${chip.look}`}>
      <Icon name={chip.icon} className="size-4" />
      {t(`state.${state}`)}
    </span>
  );
}

function SummaryRow({ view }: { readonly view: RowView }) {
  if (view.kind === "value") return <li className="break-words">{view.text}</li>;
  return (
    <li className="break-words">
      {view.before}
      <StateMark state={view.state} />
    </li>
  );
}

function SendAction() {
  const t = useText();
  const { draft, turnKey } = useDraftView();
  const busy = useBusy("send");
  return (
    <Form method="post" replace preventScrollReset className="flex flex-col">
      <input type="hidden" name="action" value="send" />
      <input type="hidden" name="revision" value={draft.revision} />
      <input type="hidden" name="turnKey" value={turnKey} />
      <Button
        id="send"
        name="intent"
        value="send"
        variant="primary"
        size="main"
        className="w-full"
        busyLabel={busy ? t("card.summary.sending") : null}
      >
        {t("card.summary.send")}
      </Button>
    </Form>
  );
}

export function SummaryCardView({ card }: { readonly card: SummaryCard }) {
  const t = useText();
  const { draft, envelope } = useDraftView();
  const hazardType = hazardOf(card.groups);
  const role = card.reporter.role === "claimedOfficer" ? "identity.role.officer" : "identity.role.citizen";
  const kept = draft.keptUntil;
  const problem = cardProblem(envelope);
  return (
    <CardShell card={card} title={t(card.titleKey, card.params)} focusId={problem ? "send" : null} ownProblem>
      {card.emergency ? (
        <Notice kind="danger">
          <p className="font-semibold">{t("card.emergency.summary")}</p>
          <p>{t("card.emergency.summaryVictims", { victims: `card.emergency.victims.${card.emergency.victims}` })}</p>
        </Notice>
      ) : (
        <p className="font-semibold tabular-nums">{t("card.summary.complete", { percent: draft.completePercent })}</p>
      )}
      <p className="text-meta text-muted tabular-nums">
        {t("resume.keptUntil", { time: clockTime(kept), zone: kept.zone, date: longDate(kept) })}
      </p>
      <LifeLine />
      <p>{t("card.summary.reporter", { name: card.reporter.name, role })}</p>
      {card.groups.map((group) => {
        const label = t(`group.${group.groupId}.label`);
        return (
          <section
            key={group.groupId}
            aria-labelledby={`group-${group.groupId}`}
            className="flex flex-col gap-2 border-t border-line pt-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`group-${group.groupId}`} className="text-body font-bold">
                {label}
              </h3>
              <TurnForm kind="editGroup" className="flex">
                <input type="hidden" name="groupId" value={group.groupId} />
                <Button aria-label={t("card.summary.editLabel", { groupLabel: label })}>
                  {t("card.summary.edit")}
                </Button>
              </TurnForm>
            </div>
            <ul className="flex flex-col gap-1.5">
              {group.rows.map((row) => (
                <SummaryRow key={row.fieldId} view={rowView(t, row, hazardType)} />
              ))}
            </ul>
          </section>
        );
      })}
      <section aria-labelledby="group-photos" className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 id="group-photos" className="text-body font-bold">
          {t("card.summary.photosTitle")}
        </h3>
        <p className="tabular-nums">
          {card.photos.count === 0 ? t("card.summary.noPhotos") : t("card.summary.photos", card.photos)}
        </p>
      </section>
      {problem ? <Notice kind="error">{t(problem.copyKey, problem.params)}</Notice> : null}
      <SendAction />
      <TurnForm kind="cancel" className="mt-4 flex flex-col">
        <Button variant="danger">{t("card.summary.cancel")}</Button>
      </TurnForm>
    </CardShell>
  );
}

export function ConfirmCard({ card }: { readonly card: Extract<Card, { kind: "confirm" }> }) {
  const t = useText();
  const base = `card.confirm.${card.confirmId}`;
  return (
    <CardShell
      card={card}
      title={t(card.titleKey, card.params)}
      prompt={card.promptKey && t(card.promptKey, card.params)}
      focusId={null}
    >
      <TurnForm kind="confirm" className="flex flex-col">
        <Button variant="danger">{t(`${base}.accept`)}</Button>
      </TurnForm>
      <TurnForm kind="dismiss" className="flex flex-col">
        <Button>{t(`${base}.back`)}</Button>
      </TurnForm>
    </CardShell>
  );
}

type EndProps = {
  readonly icon: IconName;
  readonly headingId: string;
  readonly title: string;
  readonly level?: 1 | 2;
  readonly children?: ReactNode;
  // The live card's kind and id, when the draft ended here.
  readonly card?: Card;
  readonly action: string;
};

// A closed draft: sent, cancelled, expired, not found or not signed in. No message box follows.
export function EndCard({ icon, headingId, title, level = 2, children, action, card }: EndProps) {
  const t = useText();
  const Heading = level === 1 ? "h1" : "h2";
  const heading = useMountFocus<HTMLHeadingElement>(true);
  return (
    <section
      aria-labelledby={headingId}
      data-card-kind={card?.kind}
      data-card-id={card?.cardId}
      className="flex animate-settle flex-col gap-4 card-surface p-4 md:p-5"
    >
      <Icon name={icon} className="size-8" />
      <Heading id={headingId} ref={heading} tabIndex={-1} autoFocus className="text-card font-bold text-balance">
        {title}
      </Heading>
      {children}
      <Link to="/lapor/report" className={buttonStyles({ variant: "primary", size: "main" })}>
        {t(action)}
      </Link>
    </section>
  );
}

export function CancelledCard({ card }: { readonly card: Extract<Card, { kind: "cancelled" }> }) {
  const t = useText();
  return (
    <EndCard
      card={card}
      icon="circleX"
      headingId={headingIdOf(card)}
      title={t(card.titleKey)}
      action="card.cancelled.new"
    >
      {card.promptKey ? <p>{t(card.promptKey)}</p> : null}
    </EndCard>
  );
}
