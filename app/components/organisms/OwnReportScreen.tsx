import { Form, Link, useSearchParams } from "react-router";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import type { OwnReportDetail } from "../../../src/contract/ownReport";
import { hazardKey } from "../../../src/copy/hazardKey";
import { clockTime, longDate } from "../../../src/copy/time";
import { isLimit } from "../../lib/envelope";
import { useBusy } from "../../lib/hooks";
import { limitText } from "../../lib/status";
import { useText } from "../../lib/text";
import { Button, buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { Notice } from "../molecules/Notice";
import { ContactBlock, trackingPath } from "./cards/TicketCards";
import { OwnNews } from "./OwnNews";
import { ReportEvent, ReportStatus } from "./ReportProgress";
import { FileButtons, VersionList } from "./VersionList";

// What was kept on this page just now, by its name in the address.
const SAVED = {
  sent: "followUp.saved.sent",
  cancelled: "followUp.saved.cancelled",
  newsStop: "news.saved.stop",
  newsStart: "news.saved.start",
} as const;

// A refusal of news to be added is told beside its button, any other at the top.
const isFollowUp = (envelope: ErrorEnvelope) => envelope.error.code.startsWith("followUp.");

// A report as a file, one per version.
function Documents({ report }: { readonly report: OwnReportDetail }) {
  const t = useText();
  const { ticketNumber, hazardType } = report.tracking;
  return (
    <section aria-labelledby="own-documents" className="flex flex-col gap-4 card-surface p-4 md:p-5">
      <div className="flex flex-col gap-1">
        <h2 id="own-documents" className="text-card font-bold">
          {t("version.title")}
        </h2>
        <p className="text-meta text-muted">{t("version.own.lead")}</p>
      </div>
      <VersionList
        versions={report.versions}
        hazardType={hazardType}
        voice="own"
        files={(version) => (
          <FileButtons
            version={version}
            button={(format, look, children) => (
              <a
                href={`/lapor/reports/${ticketNumber}/v${version}.${format}`}
                aria-label={look.label}
                className={look.className}
                download
              >
                {children}
              </a>
            )}
          />
        )}
      />
    </section>
  );
}

// News for the report while it is taken, and why not once it is not.
function FollowUp({ report, envelope }: { readonly report: OwnReportDetail; readonly envelope: ErrorEnvelope | null }) {
  const t = useText();
  const busy = useBusy("followUp", "action");
  const { followUp } = report;
  const open = followUp.state === "open";
  const unfinished = envelope?.error.code === "followUp.finishFirst" ? envelope.error.params.draftId : null;
  return (
    <section aria-labelledby="own-follow-up" className="flex flex-col items-start gap-3 card-surface p-4 md:p-5">
      <h2 id="own-follow-up" className="text-card font-bold">
        {t(open ? "followUp.title" : "followUp.closed.title")}
      </h2>
      <p className={open ? "tabular-nums" : "text-muted"}>
        {open
          ? t("followUp.lead", {
              date: longDate(followUp.until),
              time: clockTime(followUp.until),
              zone: followUp.until.zone,
            })
          : t(`followUp.closed.${followUp.reason}`)}
      </p>
      {envelope === null ? null : (
        <Notice kind="error">
          <p>{t(envelope.error.copyKey, envelope.error.params)}</p>
          {unfinished ? (
            <Link to={`/lapor/report/${unfinished}`} className="w-fit font-semibold underline">
              {t("followUp.finish")}
            </Link>
          ) : null}
        </Notice>
      )}
      {open ? (
        <Form method="post" className="flex w-full flex-col sm:w-auto">
          <Button
            name="action"
            value="followUp"
            variant="primary"
            size="main"
            busyLabel={busy ? t("followUp.busy") : null}
          >
            <Icon name="plus" className="size-5" />
            {t("followUp.start")}
          </Button>
        </Form>
      ) : (
        <Link to="/lapor/report" className={buttonStyles({ variant: "secondary" })}>
          {t("followUp.newReport")}
        </Link>
      )}
    </section>
  );
}

// A report on the phone that sent it (`/lapor/reports/<ticket>`): where it stands, and what only
// its reporter is given.
export function OwnReportScreen({
  report,
  envelope = null,
}: {
  readonly report: OwnReportDetail;
  // A refused act on this page.
  readonly envelope?: ErrorEnvelope | null;
}) {
  const t = useText();
  const { tracking } = report;
  const [search] = useSearchParams();
  const saved = search.get("saved");
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          to="/lapor#laporan-saya"
          className="inline-flex min-h-target-min w-fit items-center gap-2 rounded-control text-ink"
        >
          <Icon name="arrowLeft" className="size-5" />
          {t("ownReport.back")}
        </Link>
        <h1 className="text-display font-bold tabular-nums break-words">{tracking.ticketNumber}</h1>
        <p className="text-muted">
          {t("ownReport.lead", { hazard: hazardKey(tracking.hazardType), village: tracking.place.villageName })}
        </p>
      </header>
      {envelope === null && saved !== null && Object.hasOwn(SAVED, saved) ? (
        <div role="status">
          <Notice kind="info">{t(SAVED[saved as keyof typeof SAVED], { version: report.versions.length })}</Notice>
        </div>
      ) : null}
      {envelope !== null && !isFollowUp(envelope) ? (
        <Notice kind={isLimit(envelope) ? "limit" : "error"}>
          {isLimit(envelope) ? limitText(t, envelope, Date.now()) : t(envelope.error.copyKey, envelope.error.params)}
        </Notice>
      ) : null}
      {search.get("refused") === "document" ? <Notice kind="error">{t("version.refused")}</Notice> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <ReportStatus
            tracking={tracking}
            photo={(proofId, alt) => (
              <img
                src={`/api/lapor/reports/${tracking.ticketNumber}/proofs/${proofId}`}
                alt={alt}
                loading="lazy"
                className="aspect-[4/3] w-full rounded-control bg-sunken object-cover"
              />
            )}
          >
            <p>{t("card.sent.contactPromise")}</p>
          </ReportStatus>
          <OwnNews report={report} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <FollowUp report={report} envelope={envelope !== null && isFollowUp(envelope) ? envelope : null} />
          <Documents report={report} />
          <ReportEvent tracking={tracking} />
          <ContactBlock contact={tracking.contact} />
          <section aria-labelledby="own-link" className="flex flex-col items-start gap-2 card-surface p-4 md:p-5">
            <h2 id="own-link" className="text-card font-bold">
              {t("ownReport.link")}
            </h2>
            <p className="text-meta text-muted">{t("ownReport.linkHint")}</p>
            <a href={trackingPath(report.trackingToken)} className={buttonStyles({ variant: "secondary" })}>
              <Icon name="link" className="size-5" />
              {t("ownReport.linkOpen")}
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
