import { type ChangeEvent, useEffect, useId, useState } from "react";
import { deleteJson, getJson, postJson, putBytes } from "../../../lib/clientApi";
import { useText } from "../../../lib/text";
import { Button } from "../../atoms/Button";
import { Icon } from "../../atoms/Icon";

type Kept = { readonly id: string; readonly seconds: number; readonly container: string };
type Progress = {
  readonly id: string;
  readonly parts: number;
  readonly partBytes: number;
  readonly received: number[];
};

type Sending =
  | { readonly kind: "idle" }
  | { readonly kind: "sending"; readonly done: number; readonly parts: number }
  // The line broke: what has landed stays, and Lanjutkan sends the rest.
  | { readonly kind: "broken"; readonly file: File; readonly upload: Progress }
  | { readonly kind: "refused"; readonly copyKey: string };

const TRIES = 3;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The length the phone's own player reads, for a WebM whose file states none; null when it cannot.
export function browserSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (seconds: number | null) => {
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    setTimeout(() => done(null), 3000);
    video.src = url;
  });
}

const refusalOf = (answer: {
  kind: string;
  envelope?: { fields: { copyKey: string }[]; error: { copyKey: string } };
}) => answer.envelope?.fields[0]?.copyKey ?? answer.envelope?.error.copyKey ?? "card.video.failed";

// A video of the scene (D77, D89): sent in parts, each tried again, and continued where it stopped.
// Needs script, so the photo form stays the way to send with none.
export function VideoUpload({
  draftId,
  readSeconds = browserSeconds,
  retryMs = 1000,
}: {
  readonly draftId: string;
  readonly readSeconds?: (file: File) => Promise<number | null>;
  // The first wait before a part is tried again; each next wait doubles.
  readonly retryMs?: number;
}) {
  const t = useText();
  const inputId = useId();
  const base = `/drafts/${encodeURIComponent(draftId)}/videos`;
  const [kept, setKept] = useState<readonly Kept[]>([]);
  const [sending, setSending] = useState<Sending>({ kind: "idle" });

  useEffect(() => {
    void getJson<Kept[]>(base).then((answer) => answer.kind === "ok" && setKept(answer.body));
  }, [base]);

  const send = async (file: File, upload: Progress) => {
    const missing = [...Array(upload.parts).keys()].filter((n) => !upload.received.includes(n));
    let done = upload.parts - missing.length;
    for (const n of missing) {
      setSending({ kind: "sending", done, parts: upload.parts });
      const part = file.slice(n * upload.partBytes, (n + 1) * upload.partBytes);
      let landed = false;
      for (let tries = 0; tries < TRIES && !landed; tries += 1) {
        if (tries > 0) await wait(retryMs * 2 ** (tries - 1));
        const answer = await putBytes<Progress>(`${base}/${upload.id}/parts/${n}`, part);
        if (answer.kind === "refused" && answer.status !== 429 && answer.status < 500)
          return setSending({ kind: "refused", copyKey: refusalOf(answer) });
        landed = answer.kind === "ok";
      }
      if (!landed) {
        const now = await getJson<Progress>(`${base}/${upload.id}`);
        return setSending({ kind: "broken", file, upload: now.kind === "ok" ? now.body : upload });
      }
      done += 1;
    }
    setSending({ kind: "sending", done, parts: upload.parts });
    const whole = await postJson<Kept[]>(`${base}/${upload.id}/complete`, {});
    if (whole.kind === "ok") {
      setKept(whole.body);
      setSending({ kind: "idle" });
    } else if (whole.kind === "unreachable") setSending({ kind: "broken", file, upload: { ...upload, received: [] } });
    else setSending({ kind: "refused", copyKey: refusalOf(whole) });
  };

  const picked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setSending({ kind: "sending", done: 0, parts: 1 });
    const started = await postJson<Progress>(base, { bytes: file.size, seconds: await readSeconds(file) });
    if (started.kind === "ok") return send(file, started.body);
    setSending({ kind: "refused", copyKey: started.kind === "refused" ? refusalOf(started) : "card.video.failed" });
  };

  const resume = async (file: File, upload: Progress) => {
    const now = await getJson<Progress>(`${base}/${upload.id}`);
    if (now.kind === "ok") return send(file, now.body);
    setSending(
      now.kind === "unreachable" ? { kind: "broken", file, upload } : { kind: "refused", copyKey: refusalOf(now) },
    );
  };

  const remove = async (id: string) => {
    const answer = await deleteJson<Kept[]>(`${base}/${id}`);
    if (answer.kind === "ok") setKept(answer.body);
  };

  return (
    <section aria-labelledby={`${inputId}-title`} className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 id={`${inputId}-title`} className="font-bold">
        {t("card.video.title")}
      </h3>
      <p className="text-meta text-muted">{t("card.video.lead")}</p>
      {kept.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {kept.map((video, index) => (
            <li
              key={video.id}
              className="flex items-center justify-between gap-3 rounded-control border border-line px-3 py-2"
            >
              <span className="inline-flex items-center gap-2">
                <Icon name="camera" className="size-5 text-muted" />
                {t("card.video.kept", { n: index + 1, seconds: video.seconds })}
              </span>
              <Button type="button" variant="secondary" size="min" onClick={() => void remove(video.id)}>
                {t("card.video.remove")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div role="status" className="flex flex-col gap-2">
        {sending.kind === "sending" ? (
          <p>{t("card.video.sending", { done: sending.done, parts: sending.parts })}</p>
        ) : null}
        {sending.kind === "broken" ? (
          <>
            <p>{t("card.video.broken", { done: sending.upload.received.length, parts: sending.upload.parts })}</p>
            <Button type="button" variant="primary" onClick={() => void resume(sending.file, sending.upload)}>
              {t("card.video.resume")}
            </Button>
          </>
        ) : null}
        {sending.kind === "refused" ? <p className="text-danger">{t(sending.copyKey)}</p> : null}
      </div>
      {sending.kind === "sending" || sending.kind === "broken" || kept.length >= 3 ? null : (
        <label
          htmlFor={inputId}
          className="inline-flex min-h-target cursor-pointer items-center justify-center gap-2 self-start rounded-control border border-control bg-surface px-4 font-semibold text-ink hover:border-ink"
        >
          <Icon name="camera" className="size-5" />
          {t("card.video.pick")}
          <input
            id={inputId}
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            capture="environment"
            className="sr-only"
            onChange={(event) => void picked(event)}
          />
        </label>
      )}
    </section>
  );
}
