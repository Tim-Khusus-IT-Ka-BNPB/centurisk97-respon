import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { OneTapSent, OneTapStart } from "../../../src/contract/emergency";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import { postJson } from "../../lib/clientApi";
import { readPosition } from "../../lib/device";
import { useHydrated } from "../../lib/hooks";
import { limitText } from "../../lib/status";
import { useText } from "../../lib/text";
import { Button, buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { CallRow } from "../molecules/CallRow";
import { Notice } from "../molecules/Notice";

type Step =
  | { readonly kind: "ready" | "reading" | "sending" | "failed" }
  | { readonly kind: "noPosition"; readonly reason: "denied" | "unavailable" | "unsupported" }
  | { readonly kind: "refused"; readonly envelope: ErrorEnvelope }
  | { readonly kind: "sent"; readonly sent: OneTapSent };

const BUSY: readonly Step["kind"][] = ["reading", "sending"];

// The phone's point to the desk. Nothing is sent without one.
async function sendPoint(onSending: () => void): Promise<Step> {
  const read = await readPosition();
  if (read.kind !== "read") return { kind: "noPosition", reason: read.kind };
  onSending();
  const { lat, lon, accuracy } = read.position;
  const answer = await postJson<OneTapSent>("/emergencies", { lat, lon, accuracyM: accuracy });
  if (answer.kind === "ok") return { kind: "sent", sent: answer.body };
  return answer.kind === "refused" ? { kind: "refused", envelope: answer.envelope } : { kind: "failed" };
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
        {step.kind === "failed" ? (
          <Notice kind="error">
            <p>{t("emergency.failed")}</p>
          </Notice>
        ) : null}
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
                onClick={() => void send()}
              >
                <Icon name="mapPin" className="size-5" />
                {t(step.kind === "ready" ? "emergency.send" : "emergency.again")}
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
