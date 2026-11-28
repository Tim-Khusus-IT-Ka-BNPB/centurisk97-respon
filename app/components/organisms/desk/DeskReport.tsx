import { type ReactNode, useEffect, useMemo } from "react";
import { Form, Link, useFetcher, useNavigation, useSearchParams } from "react-router";
import type { DeskIdentity, DeskReport, DeskSummary } from "../../../../src/contract/desk";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { hazardKey } from "../../../../src/copy/hazardKey";
import { LANGUAGES } from "../../../../src/copy/languages";
import type { Text } from "../../../../src/copy/text";
import { cn } from "../../../lib/cn";
import type { DeskTyped, OfficerNumber } from "../../../lib/deskTypes";
import { cardProblem, isLimit } from "../../../lib/envelope";
import { limitText } from "../../../lib/status";
import { useText } from "../../../lib/text";
import { Button, buttonStyles } from "../../atoms/Button";
import { Icon } from "../../atoms/Icon";
import { FileFrame, useFileTarget } from "../../molecules/FileFrame";
import { Notice } from "../../molecules/Notice";
import { CopyButton } from "../cards/TicketCards";
import { DeskMapCanvas, SMALL } from "../DeskMapCanvas";
import { ChangeList, FileButtons, VersionList } from "../VersionList";
import { DeskActions } from "./DeskActions";
import { DeskCase } from "./DeskCase";
import { DeskComments } from "./DeskComments";
import { DeskHistory } from "./DeskHistory";
import { DeskOfficers } from "./DeskOfficers";
import { Hazard, PhotoFigure } from "./DeskQueue";
import { DeskShell } from "./DeskShell";
import { DeskToday } from "./DeskToday";
import { DeskValues } from "./DeskValues";
import {
  ALL_FILTERS,
  ClusterChip,
  EmergencyChip,
  ImpactStrip,
  NewsChip,
  OfflineChip,
  OverdueChip,
  roleText,
  StatusChip,
  spacedNumber,
  Taker,
  UnverifiedChip,
  when,
} from "./parts";

// The language a reporter wrote in, by its Indonesian name.
const languageName = (t: Text, code: string | null) =>
  LANGUAGES.find(([id]) => id === code)?.[1] ?? t("desk.words.otherLanguage");

const SAVED = [
  "status",
  "replies",
  "checks",
  "actions",
  "proofs",
  "take",
  "proofShown",
  "proofHidden",
  "released",
  "todayPulled",
  "todayRestored",
  "commentHidden",
  "commentShown",
  "figureAccepted",
  "figureRejected",
];

// With script the open is posted once per visit, beside the page: a navigation would take what the
// address says was just done off it.
function useOpened(ticketNumber: string): { readonly busy: boolean; readonly refused: ErrorEnvelope | null } {
  const { submit, state, data } = useFetcher<{ readonly envelope: ErrorEnvelope } | null>();
  useEffect(() => {
    submit({ action: "opened" }, { method: "post", action: `/desk/${ticketNumber}` });
  }, [ticketNumber, submit]);
  return { busy: state === "submitting", refused: data?.envelope ?? null };
}

// Without script the officer marks a new report as seen.
function MarkSeen({ report, opening }: { readonly report: DeskReport; readonly opening: boolean }) {
  const t = useText();
  const navigation = useNavigation();
  const busy = opening || navigation.state === "submitting";
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
      {report.proofs.length === 0 ? null : <p className="text-meta text-muted">{t("desk.proof.publicHint")}</p>}
      {report.proofs.length === 0 ? null : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {report.proofs.map((proof, index) => (
            <li key={proof.proofId}>
              <figure className="flex flex-col gap-2">
                <a href={`/api/desk/proofs/${proof.proofId}`}>
                  <img
                    src={`/api/desk/proofs/${proof.proofId}`}
                    alt={t("desk.proof.alt", { n: index + 1 })}
                    loading="lazy"
                    className="aspect-[4/3] w-full rounded-control bg-sunken object-cover"
                  />
                </a>
                <figcaption className="flex flex-col text-meta text-muted tabular-nums">
                  <span>{when(t, "desk.history.at", proof.at)}</span>
                  {proof.forwarded ? (
                    <span className="font-semibold text-ink">{t("desk.proof.forwardedBadge")}</span>
                  ) : (
                    <span>{t(proof.hasPoint ? "desk.proof.point" : "desk.proof.noPoint")}</span>
                  )}
                  {proof.public ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-ink">
                      <Icon name="circleCheck" className="size-4 text-primary" />
                      {t("desk.proof.public")}
                    </span>
                  ) : null}
                </figcaption>
                {/* A forwarded photo never goes on the Alun-alun. */}
                {proof.forwarded ? null : (
                  <Form method="post" replace preventScrollReset>
                    <input type="hidden" name="action" value="proofPublic" />
                    <input type="hidden" name="proofId" value={proof.proofId} />
                    <input type="hidden" name="public" value={proof.public ? "0" : "1"} />
                    <Button
                      size="min"
                      className="w-full px-3 text-meta"
                      aria-label={t(proof.public ? "desk.proof.hideLabel" : "desk.proof.showLabel", { n: index + 1 })}
                    >
                      {t(proof.public ? "desk.proof.hide" : "desk.proof.show")}
                    </Button>
                  </Form>
                )}
              </figure>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// The other reports of its cluster, each a link. Its figures are never added to theirs.
function Cluster({ report }: { readonly report: DeskReport }) {
  const t = useText();
  if (report.cluster === null) return null;
  return (
    <Section id="desk-cluster" title={t("desk.cluster.title")}>
      <p className="text-meta text-muted">
        {t("desk.cluster.lead", { hazard: hazardKey(report.hazardType), reporters: report.cluster.reporters })}
      </p>
      <ul className="flex flex-wrap gap-2">
        {report.cluster.tickets.map((ticket) => (
          <li key={ticket}>
            {ticket === report.ticketNumber ? (
              <span
                aria-current="page"
                className="inline-flex min-h-target-min items-center rounded-control border border-primary bg-selected px-3 font-semibold tabular-nums text-primary"
              >
                {ticket}
                <span className="sr-only">, {t("desk.cluster.this")}</span>
              </span>
            ) : (
              <Link
                to={`/desk/${ticket}`}
                className="inline-flex min-h-target-min items-center rounded-control border border-line bg-surface px-3 tabular-nums text-ink no-underline hover:border-control"
              >
                {ticket}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

// The reporter's videos of the scene, each played from the desk's own address, a range at a time.
function Videos({ report }: { readonly report: DeskReport }) {
  const t = useText();
  if (report.videos.length === 0) return null;
  return (
    <Section id="desk-videos" title={t("desk.videos.title")}>
      <ul className="grid gap-3 sm:grid-cols-2">
        {report.videos.map((video, index) => (
          <li key={video.id}>
            <figure className="flex flex-col gap-1.5">
              {/* biome-ignore lint/a11y/useMediaCaption: a reporter's own recording has no captions to give. */}
              <video
                controls
                preload="metadata"
                src={`/api/desk/reports/${encodeURIComponent(report.ticketNumber)}/videos/${video.id}`}
                className="aspect-video w-full rounded-control bg-sunken"
              />
              <figcaption className="flex flex-col text-meta text-muted">
                <span>
                  {t(video.point === null ? "desk.videos.caption" : "desk.videos.captionPlaced", {
                    n: index + 1,
                    seconds: video.seconds,
                  })}
                </span>
                {video.madeAt === null ? null : <span>{when(t, "desk.videos.made", video.madeAt)}</span>}
                {video.point === null ? null : (
                  <span className="tabular-nums">
                    {t("desk.videos.point", { lat: video.point.lat.toFixed(5), lon: video.point.lon.toFixed(5) })}
                  </span>
                )}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// The event its reporter confirmed it is of (K66, D106), by its code. BNPB may take it out.
function EventCode({ report }: { readonly report: DeskReport }) {
  const t = useText();
  const { event } = report;
  if (event === null) return null;
  return (
    <Section id="desk-event" title={t("desk.event.title", { code: event.code })}>
      <p className="text-meta text-muted">{t("desk.event.lead", { count: event.tickets.length })}</p>
      <ul className="flex flex-wrap gap-2">
        {event.tickets.map((ticket) => (
          <li key={ticket}>
            <Link
              to={`/desk/${ticket}`}
              aria-current={ticket === report.ticketNumber ? "page" : undefined}
              className="inline-flex min-h-target-min items-center rounded-control border border-line bg-surface px-3 tabular-nums text-ink no-underline hover:border-control aria-[current=page]:border-primary aria-[current=page]:bg-selected aria-[current=page]:font-semibold aria-[current=page]:text-primary"
            >
              {ticket}
            </Link>
          </li>
        ))}
      </ul>
      {event.mayRelease ? (
        <Form method="post">
          <input type="hidden" name="action" value="release" />
          <button type="submit" className={buttonStyles({ variant: "secondary", size: "min", className: "px-4" })}>
            {t("desk.event.release")}
          </button>
        </Form>
      ) : null}
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
          <Form reloadDocument method="post" action={`/desk/${report.ticketNumber}/documents`} target={target}>
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
        <p className="text-muted">{roleText(t, report)}</p>
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
        <p className="text-muted">{roleText(t, report)}</p>
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

// The report's tracking link, for a reporter who calls having lost it: asked for each time and
// logged, shown on this page only, with what to check before it is passed on.
function TrackingLink({ ticketNumber, link }: { readonly ticketNumber: string; readonly link: string | null }) {
  const t = useText();
  const asking = useNavigation().formData?.get("action") === "trackingLink";
  if (link === null)
    return (
      <Form method="post" replace preventScrollReset className="flex flex-col gap-3 border-t border-line pt-3">
        <input type="hidden" name="action" value="trackingLink" />
        <p className="text-meta text-muted">{t("desk.trackingLink.hint")}</p>
        <Button variant="secondary" className="self-start" busyLabel={asking ? t("desk.trackingLink.busy") : null}>
          <Icon name="link" className="size-5" />
          {t("desk.trackingLink.show")}
        </Button>
      </Form>
    );
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <h3 className="flex items-center gap-2 font-bold">
        <Icon name="link" className="size-5 text-primary" />
        {t("desk.trackingLink.title")}
      </h3>
      <Notice kind="danger">
        <p>{t("desk.trackingLink.check")}</p>
      </Notice>
      <p
        data-testid="desk-tracking-link"
        className="rounded-control border border-line bg-surface px-3 py-2 font-mono text-meta break-all select-all"
      >
        {link}
      </p>
      <div>
        <CopyButton
          text={link}
          label={t("desk.trackingLink.copyLabel", { ticketNumber })}
          idle={t("desk.trackingLink.copy")}
          done={t("desk.trackingLink.copied")}
        />
      </div>
    </div>
  );
}

export function DeskReportView({
  report,
  summary,
  refusal = null,
  typed = null,
  identity = null,
  officer = null,
  trackingLink = null,
}: {
  readonly report: DeskReport;
  readonly summary: DeskSummary | null;
  // A refused change on this page: a move, a reply, or marking it seen past the hourly limit.
  readonly refusal?: ErrorEnvelope | null;
  readonly typed?: DeskTyped | null;
  // Asked for on this page just now.
  readonly identity?: DeskIdentity | null;
  // A BPBD officer's number just opened, shown on this page only.
  readonly officer?: OfficerNumber | null;
  // The report's tracking link just asked for, the same way.
  readonly trackingLink?: string | null;
}) {
  const t = useText();
  // Kept the same between renders, so the map is drawn once.
  const { point } = report;
  const points = useMemo(() => (point === null ? [] : [point]), [point]);
  const [search] = useSearchParams();
  const saved = search.get("saved");
  const opened = useOpened(report.ticketNumber);
  const told = refusal ?? opened.refused;
  const problem = cardProblem(told);
  return (
    <DeskShell place={{ filters: ALL_FILTERS, current: null, summary }} account={report.account.label}>
      <Link to="/desk" className="inline-flex min-h-target-min w-fit items-center gap-2 rounded-control text-ink">
        <Icon name="arrowLeft" className="size-5" />
        {t("desk.refused.back")}
      </Link>
      {told !== null && isLimit(told) ? (
        <Notice kind="limit">
          <p>{limitText(t, told, Date.now())}</p>
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
              {report.emergency === null || report.offline?.late ? null : <EmergencyChip />}
              {report.offline === null ? null : <OfflineChip offline={report.offline} />}
              {report.news ? <NewsChip /> : null}
              {report.overdue ? <OverdueChip /> : null}
              {report.numberUnverified ? <UnverifiedChip /> : null}
              {report.cluster === null ? null : <ClusterChip cluster={report.cluster} />}
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
            {report.mayTake ? <TakeReport /> : null}
            <MarkSeen report={report} opening={opened.busy} />
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
          <Videos report={report} />
          <EventCode report={report} />
          <Cluster report={report} />
          <DeskValues report={report} />
        </div>
        <div className="flex min-w-0 flex-col gap-5 xl:col-start-2 xl:row-start-1">
          <Section id="desk-actions" title={t("desk.actions")}>
            <DeskActions report={report} envelope={refusal} typed={typed} />
          </Section>
          <Documents report={report} />
          <Section id="desk-reporter" title={t("desk.reporter")}>
            <Reporter report={report} identity={report.reporter.identity ?? identity} />
            <TrackingLink ticketNumber={report.ticketNumber} link={trackingLink} />
          </Section>
          {report.officers === null ? null : (
            <Section id="desk-officers" title={t("desk.officers.title")}>
              <DeskOfficers officers={report.officers} opened={officer} />
            </Section>
          )}
          {report.caseFile === null ? null : (
            <Section id="desk-case" title={t("desk.case.section")}>
              <DeskCase caseFile={report.caseFile} />
            </Section>
          )}
          {report.comments === null ? null : (
            <Section id="desk-comments" title={t("desk.comments.title")}>
              <DeskComments comments={report.comments} />
            </Section>
          )}
          {report.today === null ? null : (
            <Section id="desk-today" title={t("desk.today.title")}>
              <DeskToday today={report.today} />
            </Section>
          )}
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
                      {word.indonesian === null ? null : (
                        <span className="text-meta">
                          {t("desk.words.translated", {
                            language: languageName(t, word.language),
                            text: word.indonesian,
                          })}
                        </span>
                      )}
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
