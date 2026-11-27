import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Tracking } from "../../../src/contract/tracking";
import { postForFile, postJson } from "../../lib/clientApi";
import { useText } from "../../lib/text";
import { buttonStyles } from "../atoms/Button";
import { CallRow } from "../molecules/CallRow";
import { Notice } from "../molecules/Notice";
import { ContactBlock } from "./cards/TicketCards";
import { ReportEvent, ReportStatus } from "./ReportProgress";

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
async function readTracking(token: string): Promise<TrackingState> {
  const answer = await postJson<Tracking>("/tracking", { token });
  if (answer.kind === "ok") return { kind: "ok", tracking: answer.body };
  if (answer.kind === "unreachable") return { kind: "unavailable" };
  if (answer.status === 404) return { kind: "notFound" };
  if (answer.status !== 429) return { kind: "unavailable" };
  const { error, retryAt } = answer.envelope;
  const retryMs = retryAt ? Date.parse(retryAt.utc) - Date.now() : 0;
  return { kind: "limit", limit: Number(error.params.limit), minutes: Math.max(1, Math.ceil(retryMs / 60_000)) };
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

// A photo of the work. The link's secret goes in the body, so the photo has no address to share.
function Proof({ proofId, alt }: { readonly proofId: string; readonly alt: string }) {
  const t = useText();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    postForFile("/tracking/photos", { token: tokenOf(window.location.hash), proofId }).then((answer) => {
      if (!live) return;
      if (answer.kind !== "ok") {
        setFailed(true);
        return;
      }
      url = URL.createObjectURL(answer.body);
      setSrc(url);
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

function TrackingView({ tracking }: { readonly tracking: Tracking }) {
  const t = useText();
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <ReportStatus tracking={tracking} photo={(proofId, alt) => <Proof proofId={proofId} alt={alt} />}>
        <p>{t("tracking.contactPromise")}</p>
        <p className="text-meta text-muted">{t("tracking.updated")}</p>
      </ReportStatus>
      <div className="flex flex-col gap-6">
        <ReportEvent tracking={tracking} />
        <ContactBlock contact={tracking.contact} />
      </div>
    </div>
  );
}

// The tracking page (`/track`): anyone with the link, no sign-in. Never the reporter's
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
        <p className="text-muted">{t("tracking.eyebrow")}</p>
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
        <div className="grid gap-3 sm:grid-cols-3">
          <CallRow number="112" label={t("tracking.call112")} first />
          <CallRow number="117" label={t("tracking.call117")} />
          <CallRow number="113" label={t("tracking.call113")} />
        </div>
      </section>
      <p className="text-meta text-muted">{t("tracking.footer")}</p>
      <Link to="/" className={buttonStyles({ variant: "link", className: "-ms-2 self-start" })}>
        {t("tracking.back")}
      </Link>
    </div>
  );
}
