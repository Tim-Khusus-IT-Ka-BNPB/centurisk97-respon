import { Link, useSearchParams } from "react-router";
import type { OwnReportDetail } from "../../../src/contract/ownReport";
import { hazardKey } from "../../../src/copy/hazardKey";
import { useText } from "../../lib/text";
import { buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { Notice } from "../molecules/Notice";
import { ContactBlock, trackingPath } from "./cards/TicketCards";
import { ReportEvent, ReportStatus } from "./ReportProgress";
import { FileButtons, VersionList } from "./VersionList";

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

// A report on the phone that sent it (`/lapor/reports/<ticket>`): where it stands, and what only
// its reporter is given.
export function OwnReportScreen({ report }: { readonly report: OwnReportDetail }) {
  const t = useText();
  const { tracking } = report;
  const [search] = useSearchParams();
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
        </div>
        <div className="flex min-w-0 flex-col gap-6">
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
