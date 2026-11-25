import { Form, Link } from "react-router";
import type { Card } from "../../../../src/contract/card";
import type { Text } from "../../../../src/copy/text";
import { clockTime, longDate } from "../../../../src/copy/time";
import { rowParts } from "../../../../src/copy/values";
import { cardProblem } from "../../../lib/envelope";
import { useBusy, useMountFocus } from "../../../lib/hooks";
import { useText } from "../../../lib/text";
import { Button, buttonStyles } from "../../atoms/Button";
import { Icon } from "../../atoms/Icon";
import { LifeLine, Notice } from "../../molecules/Notice";
import { ChangeList } from "../VersionList";
import { CardShell, headingIdOf, TurnForm, useDraftView } from "./CardShell";

type SummaryCard = Extract<Card, { kind: "summary" }>;
type FollowUp = NonNullable<SummaryCard["followUp"]>;

// A group in one line: each value with its label, in the summary's words.
function groupLine(t: Text, group: SummaryCard["groups"][number], hazardType: string | null): string {
  if (group.rows.length === 0) return t("card.followUp.empty");
  return group.rows
    .map((row) => {
      const parts = rowParts(t, row, hazardType);
      return t("card.followUp.value", { label: parts.label, value: parts.value ?? t(`state.${parts.state}`) });
    })
    .join("; ");
}

// What would be sent, and sending it. It stands first, so it is in view after every change.
function News({ card, followUp }: { readonly card: SummaryCard; readonly followUp: FollowUp }) {
  const t = useText();
  const { draft, turnKey, envelope } = useDraftView();
  const busy = useBusy("send");
  const problem = cardProblem(envelope);
  const nothing = followUp.changes.length === 0 && card.photos.count === 0;
  return (
    <section aria-labelledby="follow-up-news" className="flex flex-col gap-3 rounded-control bg-selected p-4">
      <h3 id="follow-up-news" className="font-bold">
        {t("card.followUp.news")}
      </h3>
      {nothing ? <p className="text-muted">{t("card.followUp.nothing")}</p> : null}
      {followUp.changes.length === 0 ? null : (
        <ChangeList changes={followUp.changes} hazardType={followUp.hazardType} />
      )}
      {card.photos.count === 0 ? null : (
        <p className="flex items-center gap-2">
          <Icon name="camera" className="size-5 text-muted" />
          {t("card.followUp.photos", { count: card.photos.count })}
        </p>
      )}
      {problem ? <Notice kind="error">{t(problem.copyKey, problem.params)}</Notice> : null}
      <Form method="post" replace preventScrollReset className="flex flex-col">
        <input type="hidden" name="action" value="send" />
        <input type="hidden" name="revision" value={draft.revision} />
        <input type="hidden" name="turnKey" value={turnKey} />
        <Button
          id="send"
          name="intent"
          value="send"
          variant={nothing ? "secondary" : "primary"}
          size="main"
          className="w-full"
          busyLabel={busy ? t("card.followUp.sending") : null}
        >
          {t("card.followUp.send")}
        </Button>
      </Form>
    </section>
  );
}

// News for a report already sent: what it would change, then every part of the report that may.
export function FollowUpCardView({ card, followUp }: { readonly card: SummaryCard; readonly followUp: FollowUp }) {
  const t = useText();
  const { draft, envelope } = useDraftView();
  const kept = draft.keptUntil;
  return (
    <CardShell
      card={card}
      title={t(card.titleKey, card.params)}
      prompt={card.promptKey && t(card.promptKey, card.params)}
      focusId={cardProblem(envelope) ? "send" : null}
      ownProblem
    >
      <LifeLine />
      <News card={card} followUp={followUp} />
      <section aria-labelledby="follow-up-parts" className="flex flex-col">
        <h3 id="follow-up-parts" className="pb-2 font-bold">
          {t("card.followUp.parts")}
        </h3>
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {card.groups.map((group) => {
            const label = t(`group.${group.groupId}.label`);
            return (
              <li key={group.groupId} className="flex items-start justify-between gap-3 py-2">
                <span className="flex min-w-0 flex-col gap-0.5 py-2">
                  <span className="font-semibold">{label}</span>
                  <span className="text-meta break-words text-muted">{groupLine(t, group, followUp.hazardType)}</span>
                </span>
                <TurnForm kind="editGroup" className="flex shrink-0">
                  <input type="hidden" name="groupId" value={group.groupId} />
                  <Button size="min" variant="link" aria-label={t("card.summary.editLabel", { groupLabel: label })}>
                    {t(group.rows.length === 0 ? "card.followUp.fill" : "card.summary.edit")}
                  </Button>
                </TurnForm>
              </li>
            );
          })}
          <li className="flex items-center justify-between gap-3 py-2">
            <span className="flex min-w-0 flex-col gap-0.5 py-2">
              <span className="font-semibold">{t("card.summary.photosTitle")}</span>
              {followUp.mayAddPhotos ? null : (
                <span className="text-meta text-muted">{t("card.followUp.photosFull")}</span>
              )}
            </span>
            {followUp.mayAddPhotos ? (
              <TurnForm kind="editGroup" className="flex shrink-0">
                <input type="hidden" name="groupId" value="photos" />
                <Button size="min" variant="link">
                  {t("card.followUp.addPhotos")}
                </Button>
              </TurnForm>
            ) : null}
          </li>
        </ul>
      </section>
      <p className="text-meta text-muted tabular-nums lg:hidden">
        {t("card.followUp.keptUntil", { time: clockTime(kept), zone: kept.zone, date: longDate(kept) })}
      </p>
      <TurnForm kind="cancel" className="flex flex-col">
        <Button variant="quietDanger">{t("card.followUp.cancel")}</Button>
      </TurnForm>
    </CardShell>
  );
}

// News that was sent or dropped: the way back to its report.
export function FollowUpEndedCard({ card }: { readonly card: Extract<Card, { kind: "followUpEnded" }> }) {
  const t = useText();
  const heading = useMountFocus<HTMLHeadingElement>(true);
  return (
    <section
      aria-labelledby={headingIdOf(card)}
      data-card-kind={card.kind}
      data-card-id={card.cardId}
      className="flex animate-settle flex-col gap-4 card-surface p-4 md:p-5"
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-selected text-primary">
        <Icon name={card.outcome === "sent" ? "check" : "circleX"} className="size-7" />
      </span>
      <h2 id={headingIdOf(card)} ref={heading} tabIndex={-1} autoFocus className="text-card font-bold text-balance">
        {t(card.titleKey, card.params)}
      </h2>
      <p>{t(card.promptKey as string, card.params)}</p>
      <Link to={`/lapor/reports/${card.ticketNumber}`} className={buttonStyles({ variant: "primary", size: "main" })}>
        {t("card.followUp.open")}
      </Link>
    </section>
  );
}
