import { Link } from "react-router";
import type { MeResponse } from "../../../src/contract/draft";
import { hazardKey } from "../../../src/copy/hazardKey";
import { clockTime, longDate } from "../../../src/copy/time";
import { hazardIcon } from "../../lib/hazardIcons";
import { useText } from "../../lib/text";
import { buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { ActionRow } from "../molecules/layout";
import { Notice } from "../molecules/Notice";
import { ContactSection } from "./ContactSection";
import { MoreDoors } from "./HomeDoors";
import { HowToReport } from "./HowToReport";
import { resumeLine } from "./StartScreen";

function Resume({ profile }: { readonly profile: MeResponse["knownReporters"][number] }) {
  const t = useText();
  const draft = profile.openDraft;
  if (draft === null) return null;
  const words = draft.followUpOf === null ? "resume" : "resume.followUp";
  return (
    <section
      aria-labelledby={`resume-${draft.draftId}`}
      className="@container flex flex-col gap-3 card-surface p-4 md:p-5"
    >
      <h2 id={`resume-${draft.draftId}`} className="text-card font-bold">
        {t(`${words}.title`)}
      </h2>
      <p className="tabular-nums">{resumeLine(t, draft)}</p>
      <ActionRow>
        <Link to={`/lapor/report?discard=${profile.profileId}`} className={buttonStyles({})}>
          {t("resume.new")}
        </Link>
        <Link to={`/lapor/report/${draft.draftId}`} className={buttonStyles({ variant: "primary" })}>
          {t(`${words}.continue`)}
        </Link>
      </ActionRow>
    </section>
  );
}

type OwnReport = MeResponse["reports"][number];

// The whole row leads to the report's own page.
function ReportRow({ report }: { readonly report: OwnReport }) {
  const t = useText();
  return (
    <li className="border-t border-line first:border-t-0">
      <Link
        to={`/lapor/reports/${report.ticketNumber}`}
        className="group flex min-h-target-main items-center gap-4 px-4 py-3 text-ink no-underline hover:bg-sunken md:px-5"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-selected text-primary">
          <Icon name={hazardIcon(report.hazardType)} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-bold tabular-nums">{report.ticketNumber}</span>
            <span className="rounded-chip bg-selected px-2 py-0.5 text-meta font-semibold text-primary">
              {t(`stage.long.${report.status}`)}
            </span>
            {report.unread === 0 ? null : (
              <span className="rounded-chip bg-primary px-2 py-0.5 text-meta font-bold text-on-primary">
                {t("home.reports.unread", { count: report.unread })}
              </span>
            )}
          </span>
          <span className="text-meta text-muted">
            {t("home.reports.row", {
              hazard: hazardKey(report.hazardType),
              date: longDate(report.sentAt),
              time: clockTime(report.sentAt),
              zone: report.sentAt.zone,
            })}
          </span>
        </span>
        <span className="text-meta font-semibold text-primary max-sm:sr-only">{t("home.reports.open")}</span>
        <Icon name="chevronRight" className="size-5 text-muted" />
      </Link>
    </li>
  );
}

// "Laporan saya": what this number sent from this device, read from the database, newest first.
function OwnReports({ reports }: { readonly reports: readonly OwnReport[] }) {
  const t = useText();
  const empty = reports.length === 0;
  return (
    <section id="laporan-saya" aria-labelledby="own-reports" className="flex scroll-mt-4 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="own-reports" className="text-section font-bold tracking-[-0.015em]">
          {t("home.reports.title")}
        </h2>
        <p className="text-muted">{t(empty ? "home.reports.empty" : "home.reports.lead")}</p>
      </div>
      {empty ? null : (
        <ul className="overflow-hidden card-surface">
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
        <OwnReports reports={me.reports} />
      </>
    );
  return (
    <div className="flex flex-col gap-14 md:gap-16">
      <MoreDoors />
      {resumes}
      <HowToReport />
      <ContactSection />
    </div>
  );
}
