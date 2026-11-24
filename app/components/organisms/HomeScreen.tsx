import { Link } from "react-router";
import type { MeResponse } from "../../../src/contract/draft";
import { useText } from "../../lib/text";
import { clockTime, longDate } from "../../lib/time";
import { buttonStyles } from "../atoms/Button";
import { ActionRow } from "../molecules/layout";
import { Notice } from "../molecules/Notice";
import { ContactSection } from "./ContactSection";
import { trackingPath } from "./cards/TicketCards";
import { HowToReport } from "./HowToReport";
import { resumeLine } from "./StartScreen";

function Resume({ profile }: { readonly profile: MeResponse["knownReporters"][number] }) {
  const t = useText();
  const draft = profile.openDraft;
  if (draft === null) return null;
  return (
    <section
      aria-labelledby={`resume-${draft.draftId}`}
      className="@container flex flex-col gap-3 card-surface p-4 md:p-5"
    >
      <h2 id={`resume-${draft.draftId}`} className="text-card font-bold">
        {t("resume.title")}
      </h2>
      <p className="tabular-nums">{resumeLine(t, draft)}</p>
      <ActionRow>
        <Link to={`/lapor/report?discard=${profile.profileId}`} className={buttonStyles({})}>
          {t("resume.new")}
        </Link>
        <Link to={`/lapor/report/${draft.draftId}`} className={buttonStyles({ variant: "primary" })}>
          {t("resume.continue")}
        </Link>
      </ActionRow>
    </section>
  );
}

type OwnReport = MeResponse["reports"][number];

function ReportRow({ report }: { readonly report: OwnReport }) {
  const t = useText();
  return (
    <li className="flex flex-col gap-2 rounded-control border border-line p-3 @tiles:flex-row @tiles:items-center @tiles:justify-between">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-bold tabular-nums">{report.ticketNumber}</span>
        <span className="break-words">
          {t("home.reports.row", {
            hazard: t(`hazard.${report.hazardType}.label`),
            date: longDate(report.sentAt),
            time: clockTime(report.sentAt),
            zone: report.sentAt.zone,
          })}
        </span>
        <span className="text-meta font-semibold">{t(`stage.long.${report.status}`)}</span>
      </span>
      <a
        href={trackingPath(report.trackingToken)}
        aria-label={t("home.reports.track", { ticketNumber: report.ticketNumber })}
        className={buttonStyles({ variant: "secondary", className: "self-start" })}
      >
        {t("home.reports.open")}
      </a>
    </li>
  );
}

// "Laporan saya": what this number sent from this device, read from the database, newest first.
function OwnReports({ reports }: { readonly reports: readonly OwnReport[] }) {
  const t = useText();
  return (
    <section
      id="laporan-saya"
      aria-labelledby="own-reports"
      className="@container flex scroll-mt-4 flex-col gap-3 card-surface p-4 md:p-5"
    >
      <h2 id="own-reports" className="text-card font-bold">
        {t("home.reports.title")}
      </h2>
      <p className="text-meta text-muted">{t("home.reports.lead")}</p>
      {reports.length === 0 ? (
        <p>{t("home.reports.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {reports.map((report) => (
            <ReportRow key={report.ticketNumber} report={report} />
          ))}
        </ul>
      )}
    </section>
  );
}

// Under the opening band: the offer to resume, the reports sent, how reporting goes, and BNPB's contacts.
export function HomeScreen({ me }: { readonly me: MeResponse | null }) {
  const t = useText();
  const resumes =
    me === null ? (
      <Notice kind="info">
        <p>{t("home.error.draftsUnreadable")}</p>
        <Link to="/lapor" className={buttonStyles({ variant: "quiet", className: "self-start" })}>
          {t("home.error.retry")}
        </Link>
      </Notice>
    ) : (
      <>
        {me.knownReporters.map((profile) => (
          <Resume key={profile.profileId} profile={profile} />
        ))}
        {me.reports.length > 0 ? (
          <a href="#laporan-saya" className={buttonStyles({ variant: "secondary", className: "self-start" })}>
            {t("home.reports.check")}
          </a>
        ) : null}
        <OwnReports reports={me.reports} />
      </>
    );
  return (
    <div className="flex flex-col gap-14 md:gap-16">
      {resumes}
      <HowToReport />
      <ContactSection />
    </div>
  );
}
