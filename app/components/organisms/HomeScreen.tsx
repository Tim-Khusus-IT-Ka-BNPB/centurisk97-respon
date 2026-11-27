import { useState } from "react";
import { Link } from "react-router";
import type { MeResponse } from "../../../src/contract/draft";
import { hazardKey } from "../../../src/copy/hazardKey";
import { clockTime, longDate } from "../../../src/copy/time";
import { hazardIcon } from "../../lib/hazardIcons";
import { useHydrated } from "../../lib/hooks";
import type { MissingMine } from "../../lib/missingTypes";
import { useText } from "../../lib/text";
import { Button, buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { ActionRow } from "../molecules/layout";
import { Notice } from "../molecules/Notice";
import { SigapSays } from "../molecules/Sigap";
import { ContactSection } from "./ContactSection";
import { MoreDoors } from "./HomeDoors";
import { HowToReport } from "./HowToReport";
import { SigapTour } from "./SigapTour";
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
        <Link to={`/report?discard=${profile.profileId}`} className={buttonStyles({})}>
          {t("resume.new")}
        </Link>
        <Link to={`/report/${draft.draftId}`} className={buttonStyles({ variant: "primary" })}>
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
        to={`/reports/${report.ticketNumber}`}
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
// Upstream's three number tiles over the list: sent, in hand, finished.
function Tiles({ reports }: { readonly reports: readonly OwnReport[] }) {
  const t = useText();
  const tiles = [
    ["sent", reports.length],
    ["active", reports.filter((report) => !["closed", "invalid"].includes(report.status)).length],
    ["closed", reports.filter((report) => report.status === "closed").length],
  ] as const;
  return (
    <dl className="grid grid-cols-3 gap-3">
      {tiles.map(([key, count]) => (
        <div key={key} className="flex flex-col gap-0.5 card-surface px-4 py-3">
          <dt className="text-meta text-muted">{t(`home.reports.tiles.${key}`)}</dt>
          <dd className="text-section font-extrabold tabular-nums">{count.toLocaleString("id-ID")}</dd>
        </div>
      ))}
    </dl>
  );
}

function MissingList({ missing }: { readonly missing: readonly MissingMine[] }) {
  const t = useText();
  return (
    <section aria-labelledby="own-missing" className="flex flex-col gap-2">
      <h3 id="own-missing" className="font-bold">
        {t("home.reports.missing")}
      </h3>
      <ul className="overflow-hidden card-surface">
        {missing.map((one) => (
          <li key={one.id} className="border-t border-line first:border-t-0">
            <Link
              to="/missing"
              className="flex min-h-target-main items-center gap-4 px-4 py-3 text-ink no-underline hover:bg-sunken md:px-5"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-selected text-primary">
                <Icon name="userSearch" />
              </span>
              <span className="min-w-0 flex-1">
                {t("missing.mine.item", { name: one.name ?? t("missing.anonymous"), village: one.villageName })}
              </span>
              <span className="rounded-chip bg-selected px-2 py-0.5 text-meta font-semibold text-primary">
                {t(`missing.status.${one.status}`)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OwnReports({
  reports,
  missing,
}: {
  readonly reports: readonly OwnReport[];
  readonly missing: readonly MissingMine[];
}) {
  const t = useText();
  const empty = reports.length === 0 && missing.length === 0;
  return (
    <section id="my-reports" aria-labelledby="own-reports" className="flex scroll-mt-4 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="own-reports" className="text-section font-bold tracking-[-0.015em]">
          {t("home.reports.title")}
        </h2>
        <p className="text-muted">{t(empty ? "home.reports.empty" : "home.reports.lead")}</p>
      </div>
      {reports.length === 0 ? null : (
        <>
          <Tiles reports={reports} />
          <ul className="overflow-hidden card-surface">
            {reports.map((report) => (
              <ReportRow key={report.ticketNumber} report={report} />
            ))}
          </ul>
        </>
      )}
      {missing.length === 0 ? null : <MissingList missing={missing} />}
    </section>
  );
}

// Under the opening band: the offer to resume, the reports sent, how reporting goes, and BNPB's contacts.
// Sigap greets on the home, and offers the tour of it.
function HomeSigap() {
  const t = useText();
  const hydrated = useHydrated();
  const [touring, setTouring] = useState(false);
  return (
    <>
      <SigapSays scene="greet" title={t("sigap.home.title")} text={t("sigap.home.text")} className="max-w-xl">
        {hydrated ? (
          <Button type="button" variant="quiet" size="min" className="self-start px-0" onClick={() => setTouring(true)}>
            {t("sigap.home.tour")}
          </Button>
        ) : null}
      </SigapSays>
      {touring ? <SigapTour onClose={() => setTouring(false)} /> : null}
    </>
  );
}

export function HomeScreen({
  me,
  missing = [],
}: {
  readonly me: MeResponse | null;
  readonly missing?: readonly MissingMine[];
}) {
  const t = useText();
  const resumes =
    me === null ? (
      <Notice kind="info">
        <p>{t("home.error.draftsUnreadable")}</p>
        <Link to="/" className={buttonStyles({ variant: "quiet", className: "self-start" })}>
          {t("home.error.retry")}
        </Link>
      </Notice>
    ) : (
      <>
        {me.knownReporters.map((profile) => (
          <Resume key={profile.profileId} profile={profile} />
        ))}
        <OwnReports reports={me.reports} missing={missing} />
      </>
    );
  return (
    <div className="flex flex-col gap-14 md:gap-16">
      <HomeSigap />
      <MoreDoors />
      {resumes}
      <HowToReport />
      <ContactSection />
    </div>
  );
}
