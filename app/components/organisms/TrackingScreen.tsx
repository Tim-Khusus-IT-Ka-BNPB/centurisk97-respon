import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import type { Tracking } from "../../../src/contract/tracking";
import { useText } from "../../lib/text";
import { clockTime, localClockText, localDateText, longDate } from "../../lib/time";
import { buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { ContactItem } from "../molecules/ContactItem";
import { Notice } from "../molecules/Notice";
import { ContactBlock } from "./cards/TicketCards";

type TrackingState =
  | { readonly kind: "loading" }
  | { readonly kind: "ok"; readonly tracking: Tracking }
  | { readonly kind: "notFound" }
  | { readonly kind: "limit"; readonly limit: number; readonly minutes: number }
  | { readonly kind: "unavailable" };

const REFRESH_MS = 30_000;

// The token from the link's fragment ("#t=..."), which never reaches the server in an address.
const tokenOf = (hash: string): string => new URLSearchParams(hash.replace(/^#/, "")).get("t") ?? "";

// One read of the report. The token goes in the body of a POST.
async function readTracking(token: string, fetcher: typeof fetch = fetch): Promise<TrackingState> {
  try {
    const response = await fetcher("/api/lapor/tracking", {
      method: "POST",
      headers: { "content-type": "application/json", "x-lapor-client": "1" },
      body: JSON.stringify({ token }),
    });
    if (response.ok) return { kind: "ok", tracking: (await response.json()) as Tracking };
    if (response.status === 404) return { kind: "notFound" };
    if (response.status === 429) {
      const envelope = (await response.json()) as ErrorEnvelope;
      const retryMs = envelope.retryAt ? Date.parse(envelope.retryAt.utc) - Date.now() : 0;
      return {
        kind: "limit",
        limit: Number(envelope.error.params.limit),
        minutes: Math.max(1, Math.ceil(retryMs / 60_000)),
      };
    }
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

// Reads the report on arrival and every 30 seconds while the tab is in view.
function useTracking(): TrackingState {
  const [state, setState] = useState<TrackingState>({ kind: "loading" });
  useEffect(() => {
    const token = tokenOf(window.location.hash);
    let live = true;
    const read = async () => {
      if (document.visibilityState === "hidden") return;
      const next = await readTracking(token);
      if (live) setState(next);
    };
    void read();
    const timer = setInterval(read, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return state;
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 @tiles:flex-row @tiles:gap-4">
      <dt className="text-meta text-muted @tiles:w-40 @tiles:shrink-0">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}

// A photo of the work. The link's secret goes in the body, so the photo has no address to share.
function Proof({ proofId, alt }: { readonly proofId: string; readonly alt: string }) {
  const t = useText();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    fetch("/api/lapor/tracking/photos", {
      method: "POST",
      headers: { "content-type": "application/json", "x-lapor-client": "1" },
      body: JSON.stringify({ token: tokenOf(window.location.hash), proofId }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("photo");
        const blob = await response.blob();
        if (!live) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [proofId]);
  if (failed) return <p className="text-meta text-muted">{t("tracking.proof.unavailable")}</p>;
  return src === null ? (
    <span aria-hidden="true" className="block aspect-[4/3] w-full rounded-control bg-sunken" />
  ) : (
    <img src={src} alt={alt} className="aspect-[4/3] w-full rounded-control bg-sunken object-cover" />
  );
}

// What was done about the report, and once it is closed the photos of it.
function Handling({ tracking }: { readonly tracking: Tracking }) {
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
            <li key={proof.proofId}>
              <Proof proofId={proof.proofId} alt={t("tracking.proof.alt", { n: index + 1 })} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrackingView({ tracking }: { readonly tracking: Tracking }) {
  const t = useText();
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
  const at = (instant: NonNullable<Tracking["stages"][number]["reachedAt"]>) =>
    t("stage.reachedAt", { date: longDate(instant), time: clockTime(instant), zone: instant.zone });
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <section aria-labelledby="tracking-status" className="@container flex flex-col gap-3 card-surface p-4 md:p-5">
        <h2 id="tracking-status" className="text-card font-bold">
          {t("tracking.status")}
        </h2>
        <ol className="flex flex-col gap-3">
          {/* A report set aside waits for nothing more: its reached stages, then why. */}
          {tracking.stages
            .filter((stage) => stage.reachedAt !== null || tracking.rejected === null)
            .map((stage) => (
              <li key={stage.status} className="flex items-start gap-3">
                <Icon
                  name={stage.reachedAt ? "circleCheck" : "circleDashed"}
                  className={stage.reachedAt ? "mt-0.5 text-primary" : "mt-0.5 text-muted"}
                />
                <span className="flex min-w-0 flex-col">
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
            <li className="flex items-start gap-3">
              <Icon name="circleX" className="mt-0.5 text-danger" />
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">{t("stage.long.invalid")}</span>
                <span className="text-meta text-muted tabular-nums">{at(tracking.rejected.at)}</span>
                <span className="break-words">{t("tracking.rejected", { reason: tracking.rejected.reason })}</span>
              </span>
            </li>
          )}
        </ol>
        <Handling tracking={tracking} />
        <p>{t("tracking.contactPromise")}</p>
        <p className="text-meta text-muted">{t("tracking.updated")}</p>
      </section>
      <div className="flex flex-col gap-6">
        <section aria-labelledby="tracking-event" className="@container flex flex-col gap-3 card-surface p-4 md:p-5">
          <h2 id="tracking-event" className="text-card font-bold">
            {t("tracking.event")}
          </h2>
          <dl className="flex flex-col gap-3">
            <Row label={t("tracking.row.type")} value={t(`hazard.${tracking.hazardType}.label`)} />
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
        <ContactBlock contact={tracking.contact} />
      </div>
    </div>
  );
}

// The tracking page (`/lapor/lacak`): anyone with the link, no sign-in. Never the reporter's
// name or number, the coordinates, or RT and RW.
export function TrackingScreen() {
  const t = useText();
  const state = useTracking();
  const title =
    state.kind === "ok"
      ? state.tracking.ticketNumber
      : state.kind === "notFound"
        ? t("tracking.notFound")
        : t("tracking.loading");
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-meta font-semibold uppercase tracking-wide text-muted">{t("tracking.eyebrow")}</p>
        <h1 className="text-display font-bold tabular-nums break-words">{title}</h1>
        {state.kind === "notFound" ? <p>{t("tracking.notFoundHint")}</p> : null}
      </header>
      <noscript>
        <Notice kind="info">{t("tracking.noscript")}</Notice>
      </noscript>
      {state.kind === "limit" ? (
        <Notice kind="limit">{t("tracking.limit", { limit: state.limit, minutes: state.minutes })}</Notice>
      ) : null}
      {state.kind === "unavailable" ? <Notice kind="error">{t("tracking.unavailable")}</Notice> : null}
      {state.kind === "ok" ? <TrackingView tracking={state.tracking} /> : null}
      <section aria-labelledby="tracking-help" className="flex flex-col gap-3 card-surface p-4 md:p-5">
        <h2 id="tracking-help" className="text-card font-bold">
          {t("tracking.help")}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          <ContactItem label={t("tracking.call117")} value="117" href="tel:117" />
          <ContactItem label={t("tracking.call112")} value="112" href="tel:112" />
          <ContactItem label={t("tracking.call113")} value="113" href="tel:113" />
        </dl>
      </section>
      <p className="text-meta text-muted">{t("tracking.footer")}</p>
      <Link to="/lapor" className={buttonStyles({ variant: "quiet", className: "self-start" })}>
        {t("tracking.back")}
      </Link>
    </div>
  );
}
