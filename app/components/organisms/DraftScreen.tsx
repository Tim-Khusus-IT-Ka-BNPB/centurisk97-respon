import { useMemo } from "react";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import { clockTime, longDate } from "../../../src/copy/time";
import { isFinalCard, pageNotices, refusedWords } from "../../lib/cards";
import type { DraftActionData, DraftPageData } from "../../lib/draftTypes";
import { isLimit } from "../../lib/envelope";
import { limitText, statusText } from "../../lib/status";
import { useText } from "../../lib/text";
import { ProgressBar } from "../atoms/ProgressBar";
import { LifeLine, Notice } from "../molecules/Notice";
import { StatusRegion } from "../molecules/StatusRegion";
import { Page } from "../templates/Page";
import { CardView } from "./CardView";
import { ChatLog } from "./ChatLog";
import { DraftContext, type DraftView } from "./cards/CardShell";
import { EndCard } from "./cards/SummaryCards";
import { DraftAside } from "./DraftAside";
import { MessageBox } from "./MessageBox";

type Loaded = Extract<DraftPageData, { kind: "draft" }>;

function DraftBodyView({ view, quiet }: { readonly view: DraftView; readonly quiet: boolean }) {
  const t = useText();
  const { draft, envelope } = view;
  const card = draft.card;
  const { resumed } = pageNotices(draft.notices, card, quiet);
  const kept = draft.keptUntil;
  const now = Date.now();
  return (
    <>
      <h1 className="sr-only lg:not-sr-only lg:text-section lg:font-bold lg:tracking-[-0.015em]">
        {t(draft.followUpOf === null ? "home.report" : "followUp.title")}
      </h1>
      {isFinalCard(card) || draft.followUpOf !== null ? null : (
        <div className="flex items-center gap-3 lg:hidden">
          <ProgressBar percent={draft.completePercent} />
          <p className="shrink-0 text-meta font-semibold text-muted tabular-nums">
            {t("chat.aside.percent", { percent: draft.completePercent })}
          </p>
        </div>
      )}
      <ChatLog transcript={draft.transcript} />
      {resumed ? (
        <Notice kind="info">
          <p>{t(draft.followUpOf === null ? "notice.resumed" : "followUp.resumed")}</p>
          <p className="text-meta text-muted tabular-nums">
            {t(draft.followUpOf === null ? "resume.keptUntil" : "card.followUp.keptUntil", {
              time: clockTime(kept),
              zone: kept.zone,
              date: longDate(kept),
            })}
          </p>
        </Notice>
      ) : null}
      <CardView key={card.cardId} card={card} />
      {envelope !== null && isLimit(envelope) ? (
        <>
          <Notice kind="limit">{limitText(t, envelope, now)}</Notice>
          <LifeLine />
        </>
      ) : null}
      <StatusRegion message={statusText(t, draft, envelope, now)} />
    </>
  );
}

export function DraftScreen({ page, acted }: { readonly page: Loaded; readonly acted: DraftActionData | null }) {
  const envelope = acted?.envelope ?? page.envelope;
  const quiet = acted !== null || page.searching;
  const view = useMemo<DraftView>(() => {
    // A refusal that carries the draft (stale tab, limit) is drawn from that draft.
    const draft = envelope?.draft ?? page.draft;
    return {
      draft,
      turnKey: page.turnKey,
      envelope,
      posted: acted?.posted ?? null,
      networkLost: acted?.networkLost ?? false,
      lifeLine: pageNotices(draft.notices, draft.card, quiet).lifeLine,
      origin: page.origin,
    };
  }, [page, envelope, acted, quiet]);
  const open = !isFinalCard(view.draft.card);
  return (
    <DraftContext.Provider value={view}>
      <Page
        texts={page.texts}
        publicPage={false}
        // A sent report keeps the wide frame it was written in, for its two-column ticket.
        wide={view.draft.card.kind === "sent"}
        aside={open ? <DraftAside draft={view.draft} /> : null}
        dock={open ? <MessageBox key={view.draft.revision} /> : null}
      >
        <DraftBodyView view={view} quiet={quiet} />
      </Page>
    </DraftContext.Provider>
  );
}

// A draft that cannot be opened: expired for its owner, not found, or no reporter yet.
export function RefusedScreen({ envelope }: { readonly envelope: ErrorEnvelope }) {
  const t = useText();
  const known = refusedWords(envelope.error.code);
  const title = known.title
    ? t(known.title)
    : isLimit(envelope)
      ? limitText(t, envelope, Date.now())
      : t(envelope.error.copyKey, envelope.error.params);
  return (
    <EndCard icon="circleAlert" headingId="refused-heading" level={1} title={title} action={known.action}>
      {known.body ? <p>{t(known.body)}</p> : null}
    </EndCard>
  );
}
