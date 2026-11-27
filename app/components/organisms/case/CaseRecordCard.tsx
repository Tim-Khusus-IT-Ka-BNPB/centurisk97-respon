import { Form, Link, useNavigation } from "react-router";
import type { CaseView } from "../../../../src/contract/cases";
import { CASE_SPEC, type CaseField } from "../../../../src/domain/caseSpec";
import { cn } from "../../../lib/cn";
import { useHydrated } from "../../../lib/hooks";
import { useText } from "../../../lib/text";
import { Button, buttonStyles } from "../../atoms/Button";
import { Input } from "../../atoms/controls";
import { VideoUpload } from "../cards/VideoUpload";
import { when } from "../desk/parts";
import { recordName } from "./recordName";

type CaseRecord = CaseView["records"][number];

// A value in words: a choice by its label, a yes or no, a list by its labels.
function valueText(t: ReturnType<typeof useText>, value: unknown): string {
  if (value === true) return t("desk.case.yes");
  if (value === false) return t("desk.case.no");
  if (Array.isArray(value)) return value.map((one) => valueText(t, one)).join(", ");
  const key = `desk.case.choice.${String(value)}`;
  return /^[a-z][a-zA-Z0-9]*$/.test(String(value)) && t.has(key) ? t(key) : String(value);
}

// A field's value: another record by its name, the head of family as "self" in words.
function fieldText(
  t: ReturnType<typeof useText>,
  one: CaseField,
  value: unknown,
  records: readonly CaseRecord[],
): string {
  if (one.field.type !== "record" && one.id !== "head") return valueText(t, value);
  if (value === "self") return t("desk.case.headSelf");
  const other = records.find((record) => record.id === value);
  return other === undefined ? String(value) : recordName(t, other);
}

const chip = "rounded-chip px-2 py-0.5 text-meta font-semibold";

// One record of the file: its values (personal ones masked for BNPB until shown), what looks wrong,
// its photos, and what may be done with it.
export function CaseRecordCard({
  fileId,
  record,
  records,
  mayWrite,
  mayReveal,
  revealed,
}: {
  readonly fileId: string;
  readonly record: CaseRecord;
  readonly records: readonly CaseRecord[];
  readonly mayWrite: boolean;
  readonly mayReveal: boolean;
  readonly revealed: Readonly<Record<string, unknown>> | null;
}) {
  const t = useText();
  const navigation = useNavigation();
  // The video's sending runs in the page: shown once its script is there.
  const hydrated = useHydrated();
  const posting = navigation.formData?.get("recordId") === record.id ? navigation.formData.get("intent") : null;
  const busy = (intent: string) => (posting === intent ? t("desk.case.saving") : null);
  const personal = revealed ?? record.personal;
  const values = { ...record.data, ...personal };
  const title = recordName(t, record);
  const cancelled = record.cancelledReason !== null;
  return (
    <li>
      <article
        aria-labelledby={`case-${record.id}`}
        className={cn("flex flex-col gap-3 card-surface p-4 md:p-5", cancelled && "opacity-70")}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id={`case-${record.id}`} className="text-body font-bold">
            {title}
          </h3>
          <span className="text-meta text-muted">
            {t("desk.case.by", { by: record.by, when: when(t, "desk.history.at", record.updatedAt) })}
          </span>
        </div>
        {cancelled ? (
          <p className="font-semibold text-danger">
            {t("desk.case.cancelled", { reason: record.cancelledReason as string })}
          </p>
        ) : null}
        <dl className="grid gap-x-4 gap-y-1 text-meta sm:grid-cols-2">
          {CASE_SPEC[record.kind].fields
            .filter((one) => values[one.id] !== undefined)
            .map((one) => (
              <div key={one.id} className="flex min-w-0 flex-wrap gap-x-2">
                <dt className="text-muted">{t(`desk.case.field.${record.kind}.${one.id}`)}</dt>
                <dd className="font-semibold break-words">{fieldText(t, one, values[one.id], records)}</dd>
              </div>
            ))}
        </dl>
        {record.flags.length + record.missingPhotos.photo + record.missingPhotos.face > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label={t("desk.case.photos")}>
            {record.flags.map((flag) => (
              <li key={flag} className={cn(chip, "bg-warn-tint text-ink")}>
                {t(`desk.case.flag.${flag}`)}
              </li>
            ))}
            {record.missingPhotos.photo > 0 ? (
              <li className={cn(chip, "bg-sunken")}>
                {t("desk.case.photos.missing", { count: record.missingPhotos.photo })}
              </li>
            ) : null}
            {record.missingPhotos.face > 0 ? (
              <li className={cn(chip, "bg-sunken")}>{t("desk.case.face.missing")}</li>
            ) : null}
          </ul>
        ) : null}
        {record.media.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {record.media.map((media, index) => (
              <figure key={media.id} className="flex flex-col gap-1">
                {media.kind === "video" ? (
                  // biome-ignore lint/a11y/useMediaCaption: a resident's footage has no captions to give
                  <video
                    src={`/api/cases/${fileId}/media/${media.id}`}
                    controls
                    preload="metadata"
                    aria-label={t("desk.case.video.label", {
                      kind: `desk.case.kind.${record.kind}`,
                      seq: record.seq,
                      n: index + 1,
                    })}
                    className="aspect-square w-full rounded-control bg-sunken object-cover"
                  />
                ) : (
                  <img
                    src={`/api/cases/${fileId}/media/${media.id}`}
                    alt={t("desk.case.photo.alt", {
                      kind: `desk.case.kind.${record.kind}`,
                      seq: record.seq,
                      n: index + 1,
                    })}
                    loading="lazy"
                    className="aspect-square w-full rounded-control bg-sunken object-cover"
                  />
                )}
                <figcaption className="text-[0.75rem] text-muted">{t(`desk.case.badge.${media.badge}`)}</figcaption>
              </figure>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          {mayReveal && revealed === null && Object.keys(record.personal).length > 0 ? (
            <Form method="post" replace preventScrollReset>
              <input type="hidden" name="intent" value="reveal" />
              <input type="hidden" name="recordId" value={record.id} />
              <Button variant="secondary" size="min">
                {t("desk.case.reveal")}
              </Button>
            </Form>
          ) : null}
          {revealed === null ? null : <p className="text-meta text-muted">{t("desk.case.revealed")}</p>}
          {mayWrite && !cancelled ? (
            <>
              <Link
                to={`?kind=${record.kind}&edit=${record.id}`}
                className={buttonStyles({ variant: "secondary", size: "min", className: "no-underline" })}
              >
                {t("desk.case.change")}
              </Link>
              <Form
                method="post"
                encType="multipart/form-data"
                preventScrollReset
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="intent" value="photo" />
                <input type="hidden" name="recordId" value={record.id} />
                <input type="hidden" name="kind" value={record.kind} />
                <label className="flex flex-col gap-1 text-meta">
                  {t("desk.case.photo.add")}
                  <input
                    type="file"
                    name="photo"
                    accept="image/jpeg"
                    capture="environment"
                    required
                    className="text-meta"
                  />
                </label>
                {record.missingPhotos.face > 0 || record.media.some((one) => one.kind === "face") ? (
                  <label className="flex min-h-target-min items-center gap-2 text-meta">
                    <input type="checkbox" name="face" value="1" className="size-5" />
                    {t("desk.case.photo.face")}
                  </label>
                ) : null}
                <Button variant="secondary" size="min" busyLabel={busy("photo")}>
                  {t("desk.case.photo.button")}
                </Button>
              </Form>
              {hydrated && (record.kind === "house" || record.kind === "infrastructure") ? (
                <div className="w-full">
                  <VideoUpload base={`/cases/${fileId}/records/${record.id}/videos`} resumeKey={`case-${record.id}`} />
                </div>
              ) : null}
              <Form method="post" preventScrollReset className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="intent" value="cancel" />
                <input type="hidden" name="recordId" value={record.id} />
                <input type="hidden" name="kind" value={record.kind} />
                <span className="flex flex-col gap-1 text-meta">
                  <label htmlFor={`reason-${record.id}`}>{t("desk.case.cancel.reason")}</label>
                  <Input
                    id={`reason-${record.id}`}
                    name="reason"
                    required
                    minLength={3}
                    maxLength={300}
                    className="min-h-target-min py-1"
                  />
                </span>
                <Button variant="quietDanger" size="min" busyLabel={busy("cancel")}>
                  {t("desk.case.cancel.button")}
                </Button>
              </Form>
            </>
          ) : null}
        </div>
      </article>
    </li>
  );
}
