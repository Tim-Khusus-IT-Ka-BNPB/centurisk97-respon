import { type ReactNode, useEffect, useMemo } from "react";
import { Form, Link, useNavigation, useSearchParams, useSubmit } from "react-router";
import type { DeskIdentity, DeskReport, DeskSummary } from "../../../../src/contract/desk";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { cn } from "../../../lib/cn";
import type { DeskTyped } from "../../../lib/deskTypes";
import { cardProblem, isLimit } from "../../../lib/envelope";
import { limitText } from "../../../lib/status";
import { useText } from "../../../lib/text";
import { Button, buttonStyles } from "../../atoms/Button";
import { Icon } from "../../atoms/Icon";
import { FileFrame, useFileTarget } from "../../molecules/FileFrame";
import { Notice } from "../../molecules/Notice";
import { DeskMapCanvas, SMALL } from "../DeskMapCanvas";
import { ChangeList, FileButtons, VersionList } from "../VersionList";
import { DeskActions } from "./DeskActions";
import { DeskHistory } from "./DeskHistory";
import { Hazard, PhotoFigure } from "./DeskQueue";
import { DeskShell } from "./DeskShell";
import { DeskValues } from "./DeskValues";
import {
  ALL_FILTERS,
  EmergencyChip,
  ImpactStrip,
  NewsChip,
  StatusChip,
  spacedNumber,
  Taker,
  UnverifiedChip,
  when,
} from "./parts";

const SAVED = ["status", "replies", "checks", "actions", "proofs", "take"];

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
      <h2 id={id} className="scroll-mt-24 text-card font-bold">
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

// The report as a file, one per version. A post, as each download is logged; the answer is a file,
// so the page stays.
function Documents({ report }: { readonly report: DeskReport }) {
  const t = useText();
  const target = useFileTarget();
  return (
    <Section id="desk-documents" title={t("version.title")}>
      <p className="text-meta text-muted">{t("version.desk.lead")}</p>
      <VersionList
        versions={report.versions}
        hazardType={report.hazardType}
        voice="desk"
        files={(version) => (
          <Form reloadDocument method="post" action={`/lapor/meja/${report.ticketNumber}/documents`} target={target}>
            <input type="hidden" name="version" value={version} />
            <FileButtons
              version={version}
              button={(format, look, children) => (
                <button type="submit" name="format" value={format} aria-label={look.label} className={look.className}>
                  {children}
                </button>
              )}
            />
          </Form>
        )}
      />
      <FileFrame />
    </Section>
  );
}

// An emergency's documents and photos in one file, one tap.
function EmergencyPack({ report }: { readonly report: DeskReport }) {
  const t = useText();
  const target = useFileTarget();
  return (
    <Form
      reloadDocument
      method="post"
      action={`/lapor/meja/${report.ticketNumber}/documents`}
      target={target}
      className="flex flex-col gap-2"
    >
      <Button name="format" value="pack" variant="signal" aria-describedby="desk-pack">
        <Icon name="archive" className="size-5" />
        {t("desk.pack")}
      </Button>
      <p id="desk-pack" className="text-meta text-muted">
        {t(report.photoCount === 0 ? "desk.pack.hint.noPhotos" : "desk.pack.hint", { count: report.photoCount })}
      </p>
    </Form>
  );
}

// What the reporter added last, until an officer acts on the report.
function News({ report }: { readonly report: DeskReport }) {
  const t = useText();
  const added = report.versions.find((one) => one.madeBy === "reporter" && one.version > 1);
  if (added === undefined) return null;
  return (
    <section aria-labelledby="desk-news" className="flex flex-col gap-2 rounded-card bg-selected p-4 md:px-5">
      <h2 id="desk-news" className="flex items-center gap-2 font-bold">
        <Icon name="messageSquare" className="size-5 text-primary" />
        {t("desk.news.title", { version: added.version })}
      </h2>
      <p className="text-meta text-muted tabular-nums">{when(t, "desk.history.at", added.at)}</p>
      {added.changes.length === 0 ? (
        <p>{t("desk.news.photosOnly")}</p>
      ) : (
        <ChangeList changes={added.changes} hazardType={report.hazardType} />
      )}
    </section>
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
  // Kept the same between renders, so the map is drawn once.
  const { point } = report;
  const points = useMemo(() => (point === null ? [] : [point]), [point]);
  const [search] = useSearchParams();
  const saved = search.get("saved");
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
      {search.get("refused") === "document" ? <Notice kind="error">{t("version.refused")}</Notice> : null}
      {refusal === null && saved !== null && SAVED.includes(saved) ? (
        <div role="status">
          <Notice kind="info">
            <p>{t(`desk.saved.${saved}`, { status: `stage.long.${report.status}` })}</p>
          </Notice>
        </div>
      ) : null}
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-ticket font-bold tabular-nums">{report.ticketNumber}</h1>
              <StatusChip status={report.status} />
              {report.emergency === null ? null : <EmergencyChip />}
              {report.news ? <NewsChip /> : null}
              {report.numberUnverified ? <UnverifiedChip /> : null}
            </div>
            <Hazard item={report} />
            <div className="flex flex-col gap-0.5">
              <p className="flex items-start gap-2">
                <Icon name="mapPin" className="mt-0.5 size-5 text-muted" />
                {t("desk.row.place", {
                  village: report.place.villageName,
                  district: report.place.districtName,
                  regency: report.place.regencyName,
                })}
              </p>
              <p className="flex items-start gap-2 text-muted tabular-nums">
                <Icon name="clock" className="mt-0.5 size-5" />
                {when(t, "desk.row.sentAt", report.sentAt)}
              </p>
            </div>
            {report.taker === null ? null : <Taker taker={report.taker} />}
          </div>
          <div className="flex flex-col gap-3 sm:max-w-xs">
            {report.emergency === null ? null : <EmergencyPack report={report} />}
            {report.mayTake ? <TakeReport /> : null}
            <MarkSeen report={report} />
            <a href="#desk-actions" className={buttonStyles({ variant: "secondary", className: "xl:hidden" })}>
              <Icon name="wrench" className="size-5" />
              {t("desk.actions")}
            </a>
          </div>
        </div>
        <ImpactStrip impact={report.impact} />
        {report.news ? <News report={report} /> : null}
      </header>
      {/* On a phone the report is read first; the link in its header leads to the work under it. */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem] xl:grid-rows-[auto_1fr] xl:items-start">
        <div className="flex min-w-0 flex-col gap-5 xl:col-start-1 xl:row-span-2 xl:row-start-1">
          <div className="grid gap-5 lg:grid-cols-2">
            {point === null ? null : (
              <section aria-labelledby="desk-point" className="flex flex-col overflow-hidden card-surface">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 p-4 pb-3 md:px-5 md:pt-5">
                  <h2 id="desk-point" className="text-card font-bold">
                    {t("desk.point")}
                  </h2>
                  <p className="text-meta text-muted">{t(`desk.map.precision.${point.precision}`)}</p>
                </div>
                <div className="relative min-h-72 flex-1">
                  <DeskMapCanvas
                    points={points}
                    label={t("desk.point.map", { ticket: report.ticketNumber })}
                    framing={SMALL}
                  />
                </div>
              </section>
            )}
            <Section id="desk-photos" title={t("desk.photos")}>
              {report.photos.length === 0 ? (
                <p className="flex flex-1 flex-col items-center justify-center gap-2 rounded-control bg-sunken p-6 text-center text-muted">
                  <Icon name="camera" className="size-7" />
                  {t("desk.photos.empty")}
                </p>
              ) : (
                <ul className={cn("grid gap-3", report.photos.length > 1 ? "grid-cols-2" : "")}>
                  {report.photos.map((photo) => (
                    <li key={photo.photoId}>
                      <PhotoFigure photo={photo} own />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
          <Handling report={report} />
          <DeskValues report={report} />
        </div>
        <div className="flex min-w-0 flex-col gap-5 xl:col-start-2 xl:row-start-1">
          <Section id="desk-actions" title={t("desk.actions")}>
            <DeskActions report={report} envelope={refusal} typed={typed} />
          </Section>
          <Documents report={report} />
          <Section id="desk-reporter" title={t("desk.reporter")}>
            <Reporter report={report} identity={report.reporter.identity ?? identity} />
          </Section>
        </div>
        <div className="flex min-w-0 flex-col gap-5 xl:col-start-2 xl:row-start-2">
          <Section id="desk-history" title={t("desk.history")}>
            <DeskHistory report={report} />
          </Section>
          <Section id="desk-words" title={t("desk.words")}>
            {report.reporterWords.length === 0 ? (
              <p className="text-muted">{t("desk.words.empty")}</p>
            ) : (
              <details className="group">
                <summary className="flex min-h-target list-none items-center gap-1.5 font-semibold text-primary [&::-webkit-details-marker]:hidden">
                  <Icon name="chevronRight" className="size-4 group-open:rotate-90" />
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
