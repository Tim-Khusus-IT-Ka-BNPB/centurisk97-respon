import type { ReactNode } from "react";
import type { Tracking } from "../../../src/contract/tracking";
import { hazardKey } from "../../../src/copy/hazardKey";
import { clockTime, type Instant, localClockText, localDateText, longDate } from "../../../src/copy/time";
import { cn } from "../../lib/cn";
import { useText } from "../../lib/text";
import { Icon } from "../atoms/Icon";

// What a reporter is shown of a report's progress: on the page its link opens, and on their own.

const useAt = () => {
  const t = useText();
  return (instant: Instant) =>
    t("stage.reachedAt", { date: longDate(instant), time: clockTime(instant), zone: instant.zone });
};

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 @tiles:flex-row @tiles:items-baseline @tiles:gap-4">
      <dt className="text-meta text-muted @tiles:w-40 @tiles:shrink-0">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}

// What was done about the report, and once it is closed the photos of it.
function Handling({
  tracking,
  photo,
}: {
  readonly tracking: Tracking;
  readonly photo: (proofId: string, alt: string) => ReactNode;
}) {
  const t = useText();
  if (tracking.actions.length === 0 && tracking.proofs.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <h3 className="font-bold">{t("tracking.handling")}</h3>
      {tracking.actions.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {tracking.actions.map((action) => (
            <li key={action} className="flex items-start gap-2">
              <Icon name="check" className="mt-0.5 size-5 text-primary" />
              <span className="min-w-0 break-words">{action}</span>
            </li>
          ))}
        </ul>
      )}
      {tracking.proofs.length === 0 ? null : (
        <ul className="grid grid-cols-2 gap-3">
          {tracking.proofs.map((proof, index) => (
            <li key={proof.proofId} className="flex flex-col gap-1">
              {photo(proof.proofId, t("tracking.proof.alt", { n: index + 1 }))}
              {proof.forwarded ? <span className="text-meta text-muted">{t("tracking.proof.forwarded")}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The stages reached and waited for, why a report was set aside, and what was done.
export function ReportStatus({
  tracking,
  photo,
  children,
}: {
  readonly tracking: Tracking;
  // How a photo of the work is drawn here.
  readonly photo: (proofId: string, alt: string) => ReactNode;
  readonly children?: ReactNode;
}) {
  const t = useText();
  const at = useAt();
  return (
    <section aria-labelledby="tracking-status" className="@container flex flex-col gap-3 card-surface p-4 md:p-5">
      <h2 id="tracking-status" className="text-card font-bold">
        {t("tracking.status")}
      </h2>
      <ol className="flex flex-col">
        {/* A report set aside waits for nothing more: its reached stages, then why. */}
        {tracking.stages
          .filter((stage) => stage.reachedAt !== null || tracking.rejected === null)
          .map((stage) => (
            <li key={stage.status} className="stage-line relative flex items-start gap-4 pb-5 last:pb-0">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  stage.reachedAt ? "bg-primary text-on-primary" : "border-2 border-dashed border-control",
                )}
              >
                {stage.reachedAt ? <Icon name="check" className="size-4" /> : null}
              </span>
              <span className="flex min-w-0 flex-col pt-1">
                <span className={stage.reachedAt ? "font-semibold" : "text-muted"}>
                  {t(`stage.long.${stage.status}`)}
                </span>
                <span className="text-meta text-muted tabular-nums">
                  {stage.reachedAt ? at(stage.reachedAt) : t("stage.waiting")}
                </span>
              </span>
            </li>
          ))}
        {tracking.rejected === null ? null : (
          <li className="flex items-start gap-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-danger-tint text-danger">
              <Icon name="circleX" className="size-5" />
            </span>
            <span className="flex min-w-0 flex-col pt-1">
              <span className="font-semibold">{t("stage.long.invalid")}</span>
              <span className="text-meta text-muted tabular-nums">{at(tracking.rejected.at)}</span>
              <span className="break-words">{t("tracking.rejected", { reason: tracking.rejected.reason })}</span>
            </span>
          </li>
        )}
      </ol>
      <Handling tracking={tracking} photo={photo} />
      {children}
    </section>
  );
}

// What was reported, as anyone with its link may read it.
export function ReportEvent({ tracking }: { readonly tracking: Tracking }) {
  const t = useText();
  const at = useAt();
  const event = tracking.eventTime;
  let eventTime: string | null = null;
  if (event?.kind === "olderThan30Days") eventTime = t("value.eventTime.olderThan30Days");
  else if (event?.kind === "dateOnly")
    eventTime = t("value.eventTime.dateOnly", { date: localDateText(event.localDate) });
  else if (event)
    eventTime = t("value.eventTime.dateTime", {
      date: localDateText(event.localDate),
      time: localClockText(event.localTime),
      zone: event.zone,
    });
  return (
    <section aria-labelledby="tracking-event" className="@container flex flex-col gap-3 card-surface p-4 md:p-5">
      <h2 id="tracking-event" className="text-card font-bold">
        {t("tracking.event")}
      </h2>
      <dl className="flex flex-col gap-3">
        <Row label={t("tracking.row.type")} value={t(hazardKey(tracking.hazardType))} />
        {tracking.hazardSubtype ? (
          <Row
            label={t("tracking.row.subtype")}
            value={t(`hazardSubtype.${tracking.hazardType}.${tracking.hazardSubtype}.label`)}
          />
        ) : null}
        <Row
          label={t("tracking.row.place")}
          value={t("tracking.place", {
            village: tracking.place.villageName,
            district: tracking.place.districtName,
            regency: tracking.place.regencyName,
          })}
        />
        {eventTime ? <Row label={t("tracking.row.eventTime")} value={eventTime} /> : null}
        <Row label={t("tracking.row.sentAt")} value={at(tracking.sentAt)} />
        <Row label={t("tracking.row.photos")} value={t("tracking.photos", { count: tracking.photoCount })} />
      </dl>
    </section>
  );
}
