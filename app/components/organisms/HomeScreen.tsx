import { Link } from "react-router";
import type { MeResponse } from "../../../src/contract/draft";
import { useText } from "../../lib/text";
import { buttonStyles } from "../atoms/Button";
import { ActionRow } from "../molecules/layout";
import { Notice } from "../molecules/Notice";
import { ContactSection } from "./ContactSection";
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

// Under the opening band: the offer to resume, how reporting goes, and BNPB's contacts.
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
      me.knownReporters.map((profile) => <Resume key={profile.profileId} profile={profile} />)
    );
  return (
    <div className="flex flex-col gap-14 md:gap-16">
      {resumes}
      <HowToReport />
      <ContactSection />
    </div>
  );
}
