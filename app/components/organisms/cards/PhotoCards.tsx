import { useEffect, useRef, useState } from "react";
import { Form, useSubmit } from "react-router";
import type { Card } from "../../../../src/contract/card";
import { clockTime } from "../../../../src/copy/time";
import { isRecentFile, type Position, photoFix, preparePhoto } from "../../../lib/device";
import type { FieldProblem } from "../../../lib/envelope";
import { problemOf } from "../../../lib/envelope";
import { useBusy, useHydrated } from "../../../lib/hooks";
import { useText } from "../../../lib/text";
import { Button, buttonStyles } from "../../atoms/Button";
import { Icon } from "../../atoms/Icon";
import { FieldError } from "../../molecules/Field";
import { CardShell, TurnForm, useDraftView } from "./CardShell";

type PhotosCard = Extract<Card, { kind: "photos" }>;
type Photo = PhotosCard["photos"][number];

const API_BASE = "/api/lapor";
// A reading older than this is read again before a photo goes, so the server still takes it.
const FIX_FRESH_MS = 9 * 60_000;

// A photo sent by mistake is taken back here; the one who took it still has it.
function RemovePhoto({ photo, n }: { readonly photo: Photo; readonly n: number }) {
  const t = useText();
  const { draft, turnKey } = useDraftView();
  const busy = useBusy(photo.photoId, "photoId");
  return (
    <Form method="post" replace preventScrollReset className="mt-auto flex">
      <input type="hidden" name="action" value="removePhoto" />
      <input type="hidden" name="photoId" value={photo.photoId} />
      <input type="hidden" name="revision" value={draft.revision} />
      <input type="hidden" name="turnKey" value={turnKey} />
      <Button
        variant="quietDanger"
        size="min"
        className="px-2 py-1"
        aria-label={t("card.photos.removeOf", { n })}
        busyLabel={busy ? t("card.photos.removing") : null}
      >
        {t("card.photos.remove")}
      </Button>
    </Form>
  );
}

function PhotoItem({ photo, n, draftId }: { readonly photo: Photo; readonly n: number; readonly draftId: string }) {
  const t = useText();
  const badge = photo.badge === "none" ? "circleDashed" : "mapPin";
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-control border border-line p-2">
      <img
        src={`${API_BASE}/drafts/${encodeURIComponent(draftId)}/photos/${photo.photoId}`}
        alt={t("card.photos.item", { n })}
        width={320}
        height={240}
        loading="lazy"
        className="aspect-[4/3] h-auto w-full rounded-control bg-sunken object-cover"
      />
      <p className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-chip border border-control px-1.5 text-meta">
          <Icon name={badge} className="size-4" />
          {t(`card.photos.badge.${photo.badge}`)}
        </span>
        {photo.far ? (
          <span className="inline-flex items-center gap-1 rounded-chip border border-control bg-warn-tint px-1.5 text-meta">
            <Icon name="triangleAlert" className="size-4 text-warn-icon" />
            {t("card.photos.badge.far")}
          </span>
        ) : null}
      </p>
      <p className="text-meta tabular-nums">
        {t("card.photos.taken", {
          time: clockTime(photo.takenAt),
          zone: photo.takenAt.zone,
          source: t(`card.photos.timeSource.${photo.timeSource}`),
        })}
      </p>
      {photo.point ? (
        <p className="text-meta text-muted tabular-nums">
          {t("card.photos.point", { lat: photo.point.lat.toFixed(5), lon: photo.point.lon.toFixed(5) })}
        </p>
      ) : null}
      <RemovePhoto photo={photo} n={n} />
    </li>
  );
}

type Preparing = { readonly kind: "idle" | "preparing" } | { readonly kind: "refused"; readonly copyKey: string };

// The photo form. With no script it is a camera input and "Kirim foto"; with script the photo
// goes as soon as it is taken, shrunk, with the phone's reading and zone.
function PhotoForm({ card }: { readonly card: PhotosCard }) {
  const t = useText();
  const hydrated = useHydrated();
  const submit = useSubmit();
  const { draft, turnKey, envelope } = useDraftView();
  const sending = useBusy("photo", "action");
  const [preparing, setPreparing] = useState<Preparing>({ kind: "idle" });
  const fix = useRef<Position | null>(null);
  const full = card.photos.length >= card.max;
  useEffect(() => {
    if (!hydrated || full) return;
    photoFix().then((read) => {
      fix.current = read;
    });
  }, [hydrated, full]);
  const serverProblem = problemOf(envelope, "photo");
  const problem: FieldProblem | null =
    preparing.kind === "refused" ? { copyKey: preparing.copyKey, params: {} } : serverProblem;

  const send = async (file: File) => {
    if (!isRecentFile(file, Date.now())) {
      setPreparing({ kind: "refused", copyKey: "fieldError.photo.notRecent" });
      return;
    }
    setPreparing({ kind: "preparing" });
    const bytes = await preparePhoto(file);
    if (bytes === null) {
      setPreparing({ kind: "refused", copyKey: "fieldError.photo.unreadable" });
      return;
    }
    if (fix.current === null || Date.now() - fix.current.readAt > FIX_FRESH_MS) fix.current = await photoFix();
    const form = new FormData();
    form.set("action", "photo");
    form.set("revision", String(draft.revision));
    form.set("turnKey", turnKey);
    form.set("photo", new File([new Uint8Array(bytes)], "foto.jpg", { type: "image/jpeg" }));
    const reading = fix.current;
    for (const [name, value] of Object.entries({
      lat: reading?.lat,
      lon: reading?.lon,
      accuracy: reading?.accuracy,
      readAt: reading?.readAt,
      offset: -new Date().getTimezoneOffset(),
    }))
      form.set(name, value === undefined ? "" : String(value));
    setPreparing({ kind: "idle" });
    submit(form, { method: "post", encType: "multipart/form-data", replace: true, preventScrollReset: true });
  };

  const busy = preparing.kind === "preparing" || sending;
  return (
    <Form
      method="post"
      encType="multipart/form-data"
      replace
      preventScrollReset
      className="flex min-w-0 flex-col gap-2"
    >
      <input type="hidden" name="action" value="photo" />
      <input type="hidden" name="revision" value={draft.revision} />
      <input type="hidden" name="turnKey" value={turnKey} />
      <p className="font-semibold tabular-nums">
        {t("card.photos.count", { count: card.photos.length, max: card.max })}
      </p>
      {full ? (
        <p className="text-meta">{t("card.photos.full", { max: card.max })}</p>
      ) : (
        <>
          <label
            htmlFor="photo"
            aria-disabled={busy ? true : undefined}
            className={buttonStyles({
              variant: "primary",
              size: "main",
              className: "cursor-pointer @actions:self-start",
            })}
          >
            <Icon name="camera" />
            {busy ? t("card.photos.sending") : t("card.photos.take")}
          </label>
          <input
            id="photo"
            name="photo"
            type="file"
            accept="image/jpeg"
            capture="environment"
            required
            disabled={busy}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? "photo-error" : undefined}
            className={hydrated ? "sr-only" : "text-body"}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (hydrated && file) void send(file);
            }}
          />
          {hydrated ? null : (
            <Button variant="secondary" className="@actions:self-start">
              {t("card.photos.submit")}
            </Button>
          )}
        </>
      )}
      <FieldError id="photo" problem={problem} />
    </Form>
  );
}

export function PhotosCardView({ card }: { readonly card: PhotosCard }) {
  const t = useText();
  const { draft } = useDraftView();
  return (
    <CardShell
      card={card}
      title={t(card.titleKey, card.params)}
      prompt={card.promptKey && t(card.promptKey, card.params)}
      focusId={null}
    >
      {card.photos.length > 0 ? (
        <ul className="grid gap-3 @tiles:grid-cols-2">
          {card.photos.map((photo, index) => (
            <PhotoItem key={photo.photoId} photo={photo} n={index + 1} draftId={draft.draftId} />
          ))}
        </ul>
      ) : null}
      <PhotoForm card={card} />
      <TurnForm className="flex flex-col">
        {card.options.map((option) => (
          <Button
            key={option.id}
            name="optionIds"
            value={option.id}
            size="main"
            variant={option.id === "continue" ? "primary" : "secondary"}
          >
            {t(option.labelKey)}
          </Button>
        ))}
      </TurnForm>
    </CardShell>
  );
}
