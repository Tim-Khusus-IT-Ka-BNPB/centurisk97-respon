import type { ReactNode } from "react";
import { Form, Link, useSearchParams } from "react-router";
import type { MeResponse } from "../../../src/contract/draft";
import type { Text } from "../../../src/copy/text";
import { clockTime } from "../../../src/copy/time";
import { cn } from "../../lib/cn";
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
const EMPTY: IdentityValues = { role: "", name: "", number: "", officerRegency: "", officerPosition: "" };

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

// The start page at another step, still an emergency when it is one.
function useStep() {
  const emergency = useSearchParams()[0].has("darurat");
  return (step: string) => {
    const search = [step, ...(emergency ? ["darurat=1"] : [])].filter(Boolean).join("&");
    return search === "" ? "/lapor/report" : `/lapor/report?${search}`;
  };
}

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
          <Link to={`/lapor/report/${profile.openDraft.draftId}`} className={buttonStyles({ variant: "primary" })}>
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

// The page's name for a screen reader; its panel says the step.
export function StartHeading() {
  const t = useText();
  return <h1 className="sr-only">{t("home.report")}</h1>;
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
        <Link to={`/lapor/report/${profile.openDraft.draftId}`} className={buttonStyles({})}>
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
