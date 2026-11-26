import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { OneTapSent, OneTapStart } from "../../../src/contract/emergency";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import { hazardKey } from "../../../src/copy/hazardKey";
import { SELECTABLE_HAZARD_TYPES } from "../../../src/domain/hazards";
import { postJson } from "../../lib/clientApi";
import { readPosition } from "../../lib/device";
import { useHydrated } from "../../lib/hooks";
import { keepReport, type OfflineReport, sendKept } from "../../lib/offline";
import { limitText } from "../../lib/status";
import { useText } from "../../lib/text";
import { Button, buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { CallRow } from "../molecules/CallRow";
import { Notice } from "../molecules/Notice";

type Step =
  | { readonly kind: "ready" | "reading" | "sending" }
  // No signal: the report waits on this phone and goes when signal returns.
  | { readonly kind: "kept"; readonly report: OfflineReport }
  | { readonly kind: "noPosition"; readonly reason: "denied" | "unavailable" | "timeout" | "unsupported" }
  | { readonly kind: "refused"; readonly envelope: ErrorEnvelope }
  | { readonly kind: "sent"; readonly sent: OneTapSent };

const BUSY: readonly Step["kind"][] = ["reading", "sending"];

// A report kept on the phone goes with when it was saved and when it is sent, both by the phone's
// clock: the desk marks one more than 2 hours late and does not ring for it (LR-09).
const post = (report: OfflineReport) => postJson<OneTapSent>("/emergencies", { ...report, sentAtMs: Date.now() });

// The phone's point to the desk. Nothing is sent without one. With no signal it is kept on the
// phone, with the moment it was made and an id of its own, and sent when signal returns.
async function sendPoint(onSending: () => void): Promise<Step> {
  const read = await readPosition();
  if (read.kind !== "read") return { kind: "noPosition", reason: read.kind };
  const { lat, lon, accuracy } = read.position;
  const report = { clientId: crypto.randomUUID(), lat, lon, accuracyM: accuracy, takenAtMs: Date.now() };
  const kept = (): Step => {
    keepReport(report);
    return { kind: "kept", report };
  };
  if (navigator.onLine === false) return kept();
  onSending();
  // Sent at once it is no kept report: only its id goes with the point, so a repeat gives one ticket.
  const { takenAtMs: _saved, ...live } = report;
  const answer = await postJson<OneTapSent>("/emergencies", live);
  if (answer.kind === "ok") return { kind: "sent", sent: answer.body };
  if (answer.kind === "unreachable") return kept();
  return { kind: "refused", envelope: answer.envelope };
}

// What a kept report may still tell before it goes: its kind and whether anyone is hurt.
function KeptDetails({
  report,
  onChange,
}: {
  readonly report: OfflineReport;
  readonly onChange: (next: OfflineReport) => void;
}) {
  const t = useText();
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="font-semibold">{t("emergency.offline.hazard")}</span>
        <select
          value={report.hazardType ?? ""}
          onChange={(event) => onChange({ ...report, hazardType: event.target.value || undefined })}
          className="min-h-target rounded-control border border-control bg-surface px-3 text-ink"
        >
          <option value="">{t("emergency.offline.hazardUnknown")}</option>
          {SELECTABLE_HAZARD_TYPES.map((id) => (
            <option key={id} value={id}>
              {t(hazardKey(id))}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 font-semibold">{t("card.emergency.victims.title")}</legend>
        {(["yes", "no", "unknown"] as const).map((id) => (
          <label key={id} className="flex min-h-target-min items-center gap-3">
            <input
              type="radio"
              name="victims"
              value={id}
              checked={(report.victims ?? "unknown") === id}
              onChange={() => onChange({ ...report, victims: id })}
              className="size-5"
            />
            {t(`card.emergency.victims.${id}`)}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

// "Darurat sekali ketuk": who to call at once, and the phone's point on its way to the desk.
export function OneTapScreen({ start }: { readonly start: OneTapStart }) {
  const t = useText();
  const hydrated = useHydrated();
  const [search, setSearch] = useSearchParams();
  const tapped = search.has("ketuk");
  const [step, setStep] = useState<Step>({ kind: "ready" });
  const started = useRef(false);
  const send = useCallback(async () => {
    setStep({ kind: "reading" });
    setStep(await sendPoint(() => setStep({ kind: "sending" })));
  }, []);
  const flush = useCallback(async () => {
    const { sent } = await sendKept(post);
    if (sent[0]) setStep({ kind: "sent", sent: sent[0] });
  }, []);
  // What waits on this phone goes as soon as there is signal: on arrival, and when it comes back.
  useEffect(() => {
    void flush();
    addEventListener("online", flush);
    return () => removeEventListener("online", flush);
  }, [flush]);
  const details = (report: OfflineReport) => {
    keepReport(report);
    setStep({ kind: "kept", report });
  };
  // The tap was on the home: it is taken once, and a page opened again does not send.
  useEffect(() => {
    if (!tapped || started.current) return;
    started.current = true;
    setSearch({}, { replace: true });
    void send();
  }, [tapped, setSearch, send]);
  const contact = step.kind === "sent" ? step.sent.contact : start.contact;
  const problem = step.kind === "refused" ? step.envelope : null;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-page font-bold">{t("emergency.title")}</h1>
      <section aria-labelledby="call-now" className="flex flex-col gap-3 rounded-card bg-signal-tint p-4 md:p-6">
        <h2 id="call-now" className="text-card font-bold">
          {t("emergency.callNow")}
        </h2>
        <CallRow number="112" label={t("emergency.call112")} first />
        <CallRow number="117" label={t("emergency.call117")} />
        {contact.level === "national" ? (
          <p className="text-meta">{t("emergency.noBpbd")}</p>
        ) : (
          <CallRow number={contact.phone} label={t("emergency.callBpbd", { name: contact.name })} />
        )}
      </section>
      <section aria-labelledby="point" className="flex flex-col gap-4 card-surface p-4 md:p-6">
        <h2 id="point" className="text-card font-bold">
          {t("emergency.point")}
        </h2>
        <p className="text-muted">{t("emergency.under", { name: start.name, number: start.maskedNumber })}</p>
        <div role="status" className="flex flex-col gap-3">
          {step.kind === "reading" ? <p className="font-semibold">{t("emergency.reading")}</p> : null}
          {step.kind === "sending" ? <p className="font-semibold">{t("emergency.sending")}</p> : null}
          {step.kind === "kept" ? (
            <p className="flex items-start gap-2 font-semibold">
              <Icon name="clock" className="mt-0.5 size-5 text-primary" />
              {t("emergency.offline.kept")}
            </p>
          ) : null}
          {step.kind === "sent" ? (
            <>
              <p className="flex items-start gap-2 font-semibold">
                <Icon name="circleCheck" className="mt-0.5 size-5 text-primary" />
                {t("emergency.sent", { ticketNumber: step.sent.ticketNumber })}
              </p>
              <p>{t("emergency.sentNext")}</p>
            </>
          ) : null}
        </div>
        {step.kind === "noPosition" ? (
          <Notice kind="error">
            <p>{t(`emergency.position.${step.reason}`)}</p>
          </Notice>
        ) : null}
        {step.kind === "kept" ? <KeptDetails report={step.report} onChange={details} /> : null}
        {problem === null ? null : (
          <Notice kind={problem.fields.length > 0 ? "error" : "limit"}>
            <p>
              {problem.fields[0]
                ? t(problem.fields[0].copyKey, problem.fields[0].params)
                : limitText(t, problem, Date.now())}
            </p>
          </Notice>
        )}
        {step.kind === "sent" ? (
          <a
            href={`/lapor/reports/${step.sent.ticketNumber}`}
            className={buttonStyles({ variant: "primary", size: "main" })}
          >
            {t("emergency.track")}
          </a>
        ) : (
          <>
            {hydrated ? (
              <Button
                variant="danger"
                size="main"
                busyLabel={BUSY.includes(step.kind) ? t("emergency.busy") : null}
                onClick={() => void (step.kind === "kept" ? flush() : send())}
              >
                <Icon name="mapPin" className="size-5" />
                {t(
                  step.kind === "kept"
                    ? "emergency.offline.sendNow"
                    : step.kind === "ready"
                      ? "emergency.send"
                      : "emergency.again",
                )}
              </Button>
            ) : (
              <p>{t("emergency.noscript")}</p>
            )}
            <Link to="/lapor/report?darurat=1" className={buttonStyles({ variant: "secondary", size: "main" })}>
              {t("emergency.chat")}
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
