import type { ReactNode } from "react";
import { Form, Link, useSearchParams } from "react-router";
import type { MeResponse } from "../../../src/contract/draft";
import type { Text } from "../../../src/copy/text";
import { clockTime } from "../../../src/copy/time";
import { cn } from "../../lib/cn";
import { ABOUT_STEPS } from "../../lib/docs";
import { useBusy } from "../../lib/hooks";
import type { IdentityValues, StartActionData, StartPageData } from "../../lib/startTypes";
import { useText } from "../../lib/text";
import { Button, buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { ActionRow } from "../molecules/layout";
import { LifeLine, Notice } from "../molecules/Notice";
import { Panel } from "../molecules/Panel";
import { HiddenValues, IdentityForm } from "./IdentityForm";

type Profile = MeResponse["knownReporters"][number];
// Most who report are residents, so a new reporter starts as one; an officer changes it.
const EMPTY: IdentityValues = { role: "citizen", name: "", number: "", officerRegency: "", officerPosition: "" };

const roleKey = (role: Profile["role"]) =>
  role === "claimedOfficer" ? "identity.role.officer" : "identity.role.citizen";

// "Banjir, terakhir diubah pukul 14.05 WIB." for an open draft.
export function resumeLine(t: Text, draft: NonNullable<Profile["openDraft"]>): string {
  const at = { time: clockTime(draft.lastActedAt), zone: draft.lastActedAt.zone };
  if (draft.followUpOf !== null) return t("resume.followUp.body", { ticketNumber: draft.followUpOf, ...at });
  const hazardType = draft.hazardType ? `hazard.${draft.hazardType}.label` : "resume.noHazardType";
  return t("resume.body", { hazardType, ...at });
}

// What goes with the draft when a new report is started: a report not sent, or news for a sent one.
function replaceBody(t: Text, draft: NonNullable<Profile["openDraft"]>): string {
  if (draft.followUpOf !== null) return t("card.confirm.replaceFollowUp.body", { ticketNumber: draft.followUpOf });
  const hazardType = draft.hazardType ? `hazard.${draft.hazardType}.label` : "resume.noHazardType";
  return t("card.confirm.replaceDraft.body", { hazardType });
}

// The start page at another step, still an emergency when it is one, still for a poster's village,
// and still on the way back to a missing person's report.
function useStep() {
  const [params] = useSearchParams();
  const kept = [
    ...(params.has("emergency") ? ["emergency=1"] : []),
    ...(params.has("missing") ? ["missing=1"] : []),
    ...(POSTER_VILLAGE.test(params.get("village") ?? "") ? [`village=${params.get("village")}`] : []),
  ];
  return (step: string) => {
    const search = [step, ...kept].filter(Boolean).join("&");
    return search === "" ? "/report" : `/report?${search}`;
  };
}

const POSTER_VILLAGE = /^\d{10}$/;

function KnownRow({ profile }: { readonly profile: Profile }) {
  const t = useText();
  const step = useStep();
  const rowId = `profile-${profile.profileId}`;
  return (
    <li className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <Link
        id={rowId}
        to={step(`profile=${profile.profileId}`)}
        aria-label={t("known.row", {
          name: profile.name,
          maskedNumber: profile.maskedNumber,
          role: roleKey(profile.role),
        })}
        className={cn(buttonStyles({ size: "main" }), "justify-between text-start")}
      >
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold">{profile.name}</span>
          <span className="flex flex-wrap gap-x-2 text-meta font-normal text-muted tabular-nums">
            <span>{profile.maskedNumber}</span>
            <span>{t(roleKey(profile.role))}</span>
          </span>
        </span>
        <Icon name="chevronRight" className="text-muted" />
      </Link>
      {profile.openDraft ? (
        <div className="flex flex-col gap-2 rounded-control bg-sunken p-3">
          <p className="tabular-nums">{resumeLine(t, profile.openDraft)}</p>
          <Link to={`/report/${profile.openDraft.draftId}`} className={buttonStyles({ variant: "primary" })}>
            {t("resume.continue")}
          </Link>
        </div>
      ) : null}
      <Form method="post" className="flex">
        <input type="hidden" name="profileId" value={profile.profileId} />
        <Button name="action" value="removeProfileAsk" variant="quiet" aria-describedby={rowId}>
          {t("known.remove")}
        </Button>
      </Form>
    </li>
  );
}

function KnownList({ me, acted }: { readonly me: MeResponse; readonly acted: StartActionData | null }) {
  const t = useText();
  const step = useStep();
  return (
    <Panel id="known-heading" title={t("known.title")} lead={t("known.lead")} focusHeading={acted?.removed == null}>
      {acted?.removed ? <Notice kind="info">{t("known.removed", { maskedNumber: acted.removed })}</Notice> : null}
      {acted?.removeFailed ? (
        <Notice kind="error">{t("known.error.removeFailed", { maskedNumber: acted.removeFailed })}</Notice>
      ) : null}
      <ul className="flex flex-col gap-3">
        {me.knownReporters.map((profile) => (
          <KnownRow key={profile.profileId} profile={profile} />
        ))}
      </ul>
      <Link to={step("new=1")} className={buttonStyles({})}>
        {t("known.other")}
      </Link>
    </Panel>
  );
}

function UseProfile({
  profile,
  labelKey,
  action,
  children,
}: {
  readonly profile: Profile;
  readonly labelKey: string;
  readonly action: string;
  // A changed name and role carried through the confirm, after "Ganti".
  readonly children?: ReactNode;
}) {
  const t = useText();
  const busy = useBusy(action, "action");
  return (
    <Form method="post" className="flex flex-col">
      <input type="hidden" name="profileId" value={profile.profileId} />
      {children}
      <Button
        name="action"
        value={action}
        variant={action === "useProfile" ? "primary" : "danger"}
        busyLabel={busy ? t("common.saving") : null}
      >
        {t(labelKey)}
      </Button>
    </Form>
  );
}

function Confirm({
  id,
  title,
  body,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly children: ReactNode;
}) {
  return (
    <Panel id={id} title={title} lead={body}>
      <div className="flex flex-col gap-4">{children}</div>
    </Panel>
  );
}

function ReadBack({ number, children }: { readonly number: string; readonly children: ReactNode }) {
  const t = useText();
  const busy = useBusy("consent", "action");
  return (
    <Panel id="readback-heading" title={t("identity.readBack.title")} lead={t("identity.readBack.body")}>
      <p className="rounded-control bg-sunken px-4 py-5 text-center text-ticket font-bold tabular-nums">{number}</p>
      <Form method="post">
        {children}
        <ActionRow>
          <Button name="action" value="changeNumber" size="main" className="@actions:px-6">
            {t("identity.readBack.change")}
          </Button>
          <Button
            name="action"
            value="consent"
            variant="primary"
            size="main"
            className="@actions:flex-1"
            busyLabel={busy ? t("common.saving") : null}
          >
            {t("identity.readBack.yes")}
          </Button>
        </ActionRow>
      </Form>
    </Panel>
  );
}

// A desk session cannot report, so it is told so before anything is typed, with the way out.
function StaffSession() {
  const t = useText();
  return (
    <Panel id="staff-heading" title={t("start.staff.title")} lead={t("start.staff.body")}>
      <ActionRow>
        <Link to="/desk" className={cn(buttonStyles({ size: "main" }), "@actions:px-6")}>
          {t("start.staff.desk")}
        </Link>
        <Form method="post" action="/desk" className="flex flex-col @actions:flex-1">
          <input type="hidden" name="next" value="/report" />
          <Button name="action" value="signOut" variant="primary" size="main">
            <Icon name="logOut" />
            {t("start.staff.signOut")}
          </Button>
        </Form>
      </ActionRow>
    </Panel>
  );
}

// Beside the start on a wide screen: the steps of a report with this one marked, and the life line.
export function StartAside() {
  const t = useText();
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="aside-steps" className="card-surface flex flex-col gap-3 p-5">
        <h2 id="aside-steps" className="text-meta font-semibold text-muted">
          {t("about.steps.title")}
        </h2>
        <ol className="flex flex-col gap-1">
          {ABOUT_STEPS.map((step) => (
            <li
              key={step}
              aria-current={step === 1 ? "step" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-control px-2 py-1.5",
                step === 1 ? "bg-selected font-semibold text-ink" : "text-muted",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-meta font-bold tabular-nums",
                  step === 1 ? "bg-primary text-on-primary" : "border border-line",
                )}
              >
                {step}
              </span>
              {t(`about.step${step}.title`)}
            </li>
          ))}
        </ol>
      </section>
      <LifeLine />
    </div>
  );
}

// The page's name for a screen reader; its panel says the step. A phone has no room for the steps
// beside the page, so it shows which of them this is above it.
export function StartHeading() {
  const t = useText();
  return (
    <>
      <h1 className="sr-only">{t("home.report")}</h1>
      <div className="flex flex-col gap-2 lg:hidden">
        <p className="text-meta font-semibold text-muted">
          {t("start.step", { n: 1, total: ABOUT_STEPS.length, title: "about.step1.title" })}
        </p>
        <ol aria-hidden="true" className="grid grid-flow-col gap-1">
          {ABOUT_STEPS.map((step) => (
            <li key={step} className={cn("h-1.5 rounded-full", step === 1 ? "bg-primary" : "bg-sunken")} />
          ))}
        </ol>
      </div>
    </>
  );
}

// The start step: who reports, then consent. Every view is a page of its own with no script.
export function StartScreen({ page, acted }: { readonly page: StartPageData; readonly acted: StartActionData | null }) {
  const t = useText();
  const step = useStep();
  const view = acted?.view ?? page.view;
  const profileId = acted?.profileId ?? page.profileId;
  const profile = page.me?.knownReporters.find((known) => known.profileId === profileId) ?? null;
  const values = acted?.values ?? (profile ? { ...EMPTY, role: profile.role, name: profile.name } : EMPTY);
  const askNumber = page.me?.session == null && !(acted?.editing ?? page.editing);
  const editing = acted?.editing ?? page.editing;
  const hidden = <HiddenValues values={values} withNumber={askNumber} profileId={profileId} editing={editing} />;
  if (page.me?.session?.kind === "staff") return <StaffSession />;
  if (view === "list" && page.me) return <KnownList me={page.me} acted={acted} />;
  if (view === "confirm" && profile)
    return (
      <Panel id="confirm-heading" title={t("known.confirm", { name: profile.name, role: roleKey(profile.role) })}>
        <ActionRow>
          <Link to={step(`edit=${profile.profileId}`)} className={buttonStyles({})}>
            {t("identity.readBack.change")}
          </Link>
          <UseProfile profile={profile} labelKey="identity.readBack.yes" action="useProfile" />
        </ActionRow>
      </Panel>
    );
  if (view === "readBack") return <ReadBack number={acted?.readBack ?? ""}>{hidden}</ReadBack>;
  if (view === "declineConfirm")
    return (
      <Confirm
        id="decline-heading"
        title={t("card.confirm.declineConsent.title")}
        body={t("card.confirm.declineConsent.body")}
      >
        <Form method="post" className="flex flex-col">
          {hidden}
          <Button name="action" value="declineConfirm" variant="danger">
            {t("card.confirm.declineConsent.accept")}
          </Button>
        </Form>
        <Form method="post" className="flex flex-col">
          {hidden}
          <Button name="action" value="declineBack">
            {t("card.confirm.declineConsent.back")}
          </Button>
        </Form>
      </Confirm>
    );
  if (view === "declined")
    return (
      <Panel id="declined-heading" title={t("consent.declined.title")} lead={t("consent.declined.body")}>
        <LifeLine />
      </Panel>
    );
  if ((view === "replaceConfirm" || view === "discardConfirm") && profile?.openDraft)
    return (
      <Confirm
        id="replace-heading"
        title={t("card.confirm.replaceDraft.title")}
        body={replaceBody(t, profile.openDraft)}
      >
        {view === "discardConfirm" ? (
          <Form method="post" className="flex flex-col">
            <input type="hidden" name="draftId" value={profile.openDraft.draftId} />
            <Button name="action" value="discardOpenDraft" variant="danger">
              {t("card.confirm.replaceDraft.accept")}
            </Button>
          </Form>
        ) : (
          <UseProfile profile={profile} labelKey="card.confirm.replaceDraft.accept" action="replaceOpenDraft">
            {editing ? <HiddenValues values={values} withNumber={false} profileId={null} editing /> : null}
          </UseProfile>
        )}
        <Link to={`/report/${profile.openDraft.draftId}`} className={buttonStyles({})}>
          {t("card.confirm.replaceDraft.back")}
        </Link>
      </Confirm>
    );
  if (view === "removeConfirm" && profile)
    return (
      <Confirm
        id="remove-heading"
        title={t("card.confirm.removeProfile.title", { name: profile.name })}
        body={t("card.confirm.removeProfile.body", { maskedNumber: profile.maskedNumber })}
      >
        <Form method="post" className="flex flex-col">
          <input type="hidden" name="profileId" value={profile.profileId} />
          <input type="hidden" name="maskedNumber" value={profile.maskedNumber} />
          <input type="hidden" name="confirm" value="yes" />
          <Button name="action" value="removeProfile" variant="danger">
            <Icon name="circleX" />
            {t("card.confirm.removeProfile.accept")}
          </Button>
        </Form>
        <Link to={step("")} className={buttonStyles({})}>
          {t("card.confirm.removeProfile.back")}
        </Link>
      </Confirm>
    );
  return (
    <IdentityForm
      values={values}
      envelope={acted?.envelope ?? null}
      askNumber={askNumber}
      profileId={editing ? profileId : null}
      editing={editing}
      unreadable={page.me === null}
      focusNumber={acted?.focusNumber ?? false}
    />
  );
}
