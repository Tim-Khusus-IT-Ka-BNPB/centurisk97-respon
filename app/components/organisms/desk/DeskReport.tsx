import { type ReactNode, useEffect } from "react";
import { Form, Link, useNavigation, useSearchParams, useSubmit } from "react-router";
import type { DeskIdentity, DeskReport, DeskSummary } from "../../../../src/contract/desk";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import type { DeskTyped } from "../../../lib/deskTypes";
import { cardProblem, isLimit } from "../../../lib/envelope";
import { limitText } from "../../../lib/status";
import { hazardOf, rowParts } from "../../../lib/summary";
import { type Text, useText } from "../../../lib/text";
import { Button, buttonStyles } from "../../atoms/Button";
import { Icon } from "../../atoms/Icon";
import { Notice } from "../../molecules/Notice";
import { StateMark } from "../cards/SummaryCards";
import { DeskActions } from "./DeskActions";
import { Hazard, PhotoFigure } from "./DeskQueue";
import { DeskShell } from "./DeskShell";
import {
  ALL_FILTERS,
  EmergencyChip,
  Houses,
  StatusChip,
  spacedNumber,
  Taker,
  UnverifiedChip,
  Victims,
  when,
} from "./parts";

const SAVED = ["status", "replies", "checks", "actions", "proofs", "take"];

function Origin({ origin, quote }: { readonly origin: string | null; readonly quote: string | null }) {
  const t = useText();
  if (origin === null) return null;
  return (
    <p className="text-meta text-muted">
      {t(`desk.origin.${origin}`)}
      {quote === null ? null : <q className="ms-1 text-ink">{quote}</q>}
    </p>
  );
}

// With script the open is posted once per visit; without, the officer marks it.
function MarkSeen({ report }: { readonly report: DeskReport }) {
  const t = useText();
  const submit = useSubmit();
  const busy = useNavigation().state === "submitting";
  useEffect(() => {
    submit(null, {
      method: "post",
      action: `/lapor/meja/${report.ticketNumber}`,
      replace: true,
      preventScrollReset: true,
    });
  }, [report.ticketNumber, submit]);
  if (report.status !== "new") return null;
  return (
    <Form method="post" replace preventScrollReset className="flex flex-col gap-2">
      <p className="text-meta text-muted">{t("desk.markSeen.hint")}</p>
      <Button variant="primary" className="self-start" busyLabel={busy ? t("desk.markSeen.busy") : null}>
        {t("desk.markSeen")}
      </Button>
    </Form>
  );
}

function Section({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 card-surface p-4 md:p-5">
      <h2 id={id} className="scroll-mt-20 text-card font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

// "Ambil laporan": this officer has it in hand from now, once and for all.
function TakeReport() {
  const t = useText();
  const busy = useNavigation().formData?.get("action") === "take";
  return (
    <Form method="post" replace preventScrollReset className="flex flex-col gap-2">
      <input type="hidden" name="action" value="take" />
      <p className="text-meta text-muted">{t("desk.take.hint")}</p>
      <Button type="submit" variant="secondary" className="self-start" busyLabel={busy ? t("desk.busy") : null}>
        {t("desk.take")}
      </Button>
    </Form>
  );
}

// A history row's name: the status it reached, or the work it tells of.
function historyTitle(t: Text, entry: DeskReport["history"][number]): string {
  if (entry.event === "actions") return t("desk.handling.actions");
  if (entry.event === "take") return t("desk.taker", { taker: entry.detail?.taker as string });
  if (entry.event === "fieldCheck")
    return t("desk.history.check", { result: `desk.check.result.${entry.detail?.result}` });
  return t(`stage.long.${entry.status}`);
}

// What was done: its actions, and the photos of it.
function Handling({ report }: { readonly report: DeskReport }) {
  const t = useText();
  if (report.actions.length === 0 && report.proofs.length === 0) return null;
  return (
    <Section id="desk-handling" title={t("desk.handling")}>
      {report.actions.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {report.actions.map((action) => (
            <li key={action.label} className="flex items-start gap-2">
              <Icon name="circleCheck" className="mt-0.5 size-5 text-primary" />
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold break-words">{action.label}</span>
                <span className="text-meta text-muted tabular-nums">
                  {t("desk.reply.by", { actor: action.actor, at: when(t, "desk.history.at", action.at) })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {report.proofs.length === 0 ? null : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {report.proofs.map((proof, index) => (
            <li key={proof.proofId}>
              <figure className="flex flex-col gap-2">
                <a href={`/api/lapor/desk/proofs/${proof.proofId}`}>
                  <img
                    src={`/api/lapor/desk/proofs/${proof.proofId}`}
                    alt={t("desk.proof.alt", { n: index + 1 })}
                    loading="lazy"
                    className="aspect-[4/3] w-full rounded-control bg-sunken object-cover"
                  />
                </a>
                <figcaption className="flex flex-col text-meta text-muted tabular-nums">
                  <span>{when(t, "desk.history.at", proof.at)}</span>
                  <span>{t(proof.hasPoint ? "desk.proof.point" : "desk.proof.noPoint")}</span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// Who reported. An account that must ask for it is told each ask is logged; the answer is on this
// page only.
function Reporter({ report, identity }: { readonly report: DeskReport; readonly identity: DeskIdentity | null }) {
  const t = useText();
  const asking = useNavigation().formData?.get("action") === "identity";
  if (identity === null)
    return (
      <Form method="post" replace preventScrollReset className="flex flex-col gap-3">
        <input type="hidden" name="action" value="identity" />
        <p className="text-muted">{t(`desk.role.${report.reporter.role}`)}</p>
        <p className="text-meta text-muted">{t("desk.identity.hint")}</p>
        <Button variant="secondary" className="self-start" busyLabel={asking ? t("desk.identity.busy") : null}>
          {t("desk.identity.show")}
        </Button>
      </Form>
    );
  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{identity.name}</p>
        <p className="text-muted">{t(`desk.role.${report.reporter.role}`)}</p>
        {identity.officerRegency !== null ? (
          <p>
            {t("desk.reporter.officer", {
              regency: identity.officerRegency,
              position: identity.officerPosition as string,
            })}
          </p>
        ) : null}
      </div>
      <a
        href={`tel:${identity.number}`}
        className="inline-flex min-h-target items-center gap-2 self-start rounded-control border border-control bg-surface px-4 font-semibold text-ink tabular-nums no-underline hover:bg-sunken"
      >
        <Icon name="phone" className="size-5" />
        {t("desk.reporter.call", { number: spacedNumber(identity.number) })}
      </a>
      {report.numberUnverified ? <p className="text-meta text-muted">{t("desk.reporter.unverifiedHint")}</p> : null}
    </>
  );
}

export function DeskReportView({
  report,
  summary,
  refusal = null,
  typed = null,
  identity = null,
}: {
  readonly report: DeskReport;
  readonly summary: DeskSummary | null;
  // A refused change on this page: a move, a reply, or marking it seen past the hourly limit.
  readonly refusal?: ErrorEnvelope | null;
  readonly typed?: DeskTyped | null;
  // Asked for on this page just now.
  readonly identity?: DeskIdentity | null;
}) {
  const t = useText();
  const hazardType = hazardOf(report.groups);
  const saved = useSearchParams()[0].get("saved");
  const problem = cardProblem(refusal);
  return (
    <DeskShell place={{ filters: ALL_FILTERS, current: null, summary }} account={report.account.label}>
      <Link to="/lapor/meja" className="inline-flex min-h-target-min w-fit items-center gap-2 rounded-control text-ink">
        <Icon name="arrowLeft" className="size-5" />
        {t("desk.refused.back")}
      </Link>
      {refusal !== null && isLimit(refusal) ? (
        <Notice kind="limit">
          <p>{limitText(t, refusal, Date.now())}</p>
        </Notice>
      ) : null}
      {problem === null ? null : (
        <Notice kind="error">
          <p>{t(problem.copyKey, problem.params)}</p>
        </Notice>
      )}
      {refusal === null && saved !== null && SAVED.includes(saved) ? (
        <div role="status">
          <Notice kind="info">
            <p>{t(`desk.saved.${saved}`, { status: `stage.long.${report.status}` })}</p>
          </Notice>
        </div>
      ) : null}
      <header className="flex flex-col gap-4 card-surface p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-ticket font-bold tabular-nums">{report.ticketNumber}</h1>
          <StatusChip status={report.status} />
          {report.emergency === null ? null : <EmergencyChip />}
          {report.numberUnverified ? <UnverifiedChip /> : null}
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="flex min-w-0 flex-col gap-1">
            <Hazard item={report} />
            <p>
              {t("desk.row.place", {
                village: report.place.villageName,
                district: report.place.districtName,
                regency: report.place.regencyName,
              })}
            </p>
            <p className="text-meta text-muted tabular-nums">{when(t, "desk.row.sentAt", report.sentAt)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Victims impact={report.impact} />
            <Houses impact={report.impact} />
          </div>
        </div>
        {report.taker === null ? null : <Taker taker={report.taker} />}
        {report.mayTake ? <TakeReport /> : null}
        <MarkSeen report={report} />
        <a href="#desk-actions" className={buttonStyles({ variant: "secondary", className: "self-start xl:hidden" })}>
          <Icon name="wrench" className="size-5" />
          {t("desk.actions")}
        </a>
      </header>
      {/* On a phone the report is read first; the link in its header leads to the work under it. */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_25rem] xl:grid-rows-[auto_1fr] xl:items-start">
        <div className="flex min-w-0 flex-col gap-5 xl:col-start-1 xl:row-span-2 xl:row-start-1">
          <Section id="desk-photos" title={t("desk.photos")}>
            {report.photos.length === 0 ? (
              <p className="text-muted">{t("desk.photos.empty")}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {report.photos.map((photo) => (
                  <li key={photo.photoId}>
                    <PhotoFigure photo={photo} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Handling report={report} />
          <Section id="desk-values" title={t("desk.values")}>
            <p className="-mt-2 text-meta text-muted">{t("desk.complete", { percent: report.completePercent })}</p>
            {report.groups.map((group) => (
              <div key={group.groupId} className="flex flex-col gap-3 border-t border-line pt-4">
                <h3 className="font-bold">{t(`group.${group.groupId}.label`)}</h3>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
                  {group.rows.map((row) => {
                    const parts = rowParts(t, row, hazardType);
                    return (
                      <div key={row.fieldId} className="contents">
                        <dt className="text-muted">{parts.label}</dt>
                        <dd className="flex min-w-0 flex-col gap-0.5">
                          {parts.value === null ? (
                            <span>
                              <StateMark state={parts.state as "none" | "confirmedUnknown" | "notYetKnown"} />
                            </span>
                          ) : (
                            <span className="break-words">{parts.value}</span>
                          )}
                          <Origin origin={row.state === "notYetKnown" ? null : row.origin} quote={row.quote} />
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ))}
          </Section>
        </div>
        <div className="flex min-w-0 flex-col gap-5 xl:col-start-2 xl:row-start-1">
          <Section id="desk-actions" title={t("desk.actions")}>
            <DeskActions report={report} envelope={refusal} typed={typed} />
          </Section>
          <Section id="desk-reporter" title={t("desk.reporter")}>
            <Reporter report={report} identity={report.reporter.identity ?? identity} />
          </Section>
        </div>
        <div className="flex min-w-0 flex-col gap-5 xl:col-start-2 xl:row-start-2">
          <Section id="desk-history" title={t("desk.history")}>
            <ol className="flex flex-col">
              {report.history.map((entry, index) => (
                <li key={`${entry.status}-${entry.at.utc}`} className="relative flex gap-3 pb-4 last:pb-0">
                  <span className="flex flex-col items-center">
                    <span className="mt-1.5 size-2.5 rounded-full bg-primary" aria-hidden="true" />
                    {index < report.history.length - 1 ? (
                      <span className="mt-1 w-px flex-1 bg-line" aria-hidden="true" />
                    ) : null}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{historyTitle(t, entry)}</span>
                    <span className="text-meta text-muted tabular-nums">{when(t, "desk.history.at", entry.at)}</span>
                    <span className="text-meta">{entry.actor ?? t("desk.history.system")}</span>
                    {(entry.detail?.changes ?? []).map((change) => (
                      <span key={change.fieldId}>
                        {t("desk.history.change", {
                          label: `field.${change.fieldId}.label`,
                          from: change.from === null ? "desk.impact.unknown" : change.from,
                          to: change.to,
                        })}
                      </span>
                    ))}
                    {entry.detail?.actions ? <span>{entry.detail.actions.join(", ")}</span> : null}
                    {entry.forwardedTo === null ? null : (
                      <span>{t("desk.history.forwardedTo", { regency: entry.forwardedTo })}</span>
                    )}
                    {entry.note === null ? null : <span>{entry.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Section>
          <Section id="desk-words" title={t("desk.words")}>
            {report.reporterWords.length === 0 ? (
              <p className="text-muted">{t("desk.words.empty")}</p>
            ) : (
              <details>
                <summary className="min-h-target cursor-pointer py-2 font-semibold">
                  {t("desk.words.show", { count: report.reporterWords.length })}
                </summary>
                <ol className="flex flex-col gap-3">
                  {report.reporterWords.map((word, index) => (
                    // Answers of one minute share a time, so their order is their key.
                    // biome-ignore lint/suspicious/noArrayIndexKey: the list is append-only and never reordered
                    <li key={index} className="flex flex-col">
                      <q>{word.text}</q>
                      <span className="text-meta text-muted tabular-nums">{when(t, "desk.history.at", word.at)}</span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </Section>
        </div>
      </div>
    </DeskShell>
  );
}
