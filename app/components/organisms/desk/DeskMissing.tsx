import { Form, Link } from "react-router";
import type { DeskSummary } from "../../../../src/contract/desk";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { localClockText, localShortDate } from "../../../../src/copy/time";
import { MISSING_STATUSES, type MissingStatus, mayMoveMissing } from "../../../../src/domain/missingPerson";
import type { DeskMissingOne } from "../../../lib/missingTypes";
import { limitText } from "../../../lib/status";
import { useText } from "../../../lib/text";
import { Button } from "../../atoms/Button";
import { Input } from "../../atoms/controls";
import { Icon } from "../../atoms/Icon";
import { Notice } from "../../molecules/Notice";
import { DeskShell } from "./DeskShell";
import { ALL_FILTERS, spacedNumber, whenShort } from "./parts";

const BASE = "/desk/missing";

function Person({ one }: { readonly one: DeskMissingOne }) {
  const t = useText();
  const place = { village: one.place.villageName, district: one.place.districtName, regency: one.place.regencyName };
  const name = one.name ?? t("missing.anonymous");
  const moves = MISSING_STATUSES.filter((to) => mayMoveMissing(one.status, to));
  const facts = [
    one.nickname ? t("missing.desk.nickname", { nickname: one.nickname }) : null,
    t(`missing.relation.${one.relation}`),
    t(`missing.sex.${one.sex}`),
    one.age === null ? null : t("missing.desk.age", { age: one.age }),
  ].filter((fact) => fact !== null);
  return (
    <li id={`orang-${one.id}`} className="flex scroll-mt-6 flex-col gap-3 card-surface p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-card font-bold break-words">{name}</h2>
          <p className="text-meta text-muted">{facts.join(", ")}</p>
        </div>
        <span className="rounded-control bg-sunken px-2 py-0.5 text-meta font-semibold">
          {t(`missing.status.${one.status}`)}
        </span>
      </div>
      <div className="flex flex-wrap gap-4">
        {one.hasPhoto ? (
          <a href={`/api/desk/missing/${one.id}/photo`} className="shrink-0 rounded-control">
            <img
              src={`/api/desk/missing/${one.id}/photo`}
              alt={t("missing.desk.photo", { name })}
              className="size-32 rounded-control object-cover"
              loading="lazy"
            />
          </a>
        ) : null}
        <ul className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
          <li>
            {one.lastSeen.time === null
              ? t("missing.desk.lastSeen", { date: localShortDate(one.lastSeen.date), ...place })
              : t("missing.desk.lastSeenAt", {
                  date: localShortDate(one.lastSeen.date),
                  time: localClockText(one.lastSeen.time),
                  zone: one.lastSeen.zone,
                  ...place,
                })}
          </li>
          {one.clothes ? <li>{t("missing.desk.clothes", { text: one.clothes })}</li> : null}
          {one.marks ? <li>{t("missing.desk.marks", { text: one.marks })}</li> : null}
          {one.waitPlace ? <li>{t("missing.desk.wait", { place: one.waitPlace })}</li> : null}
          <li className="text-meta text-muted">
            {one.reporterName === null
              ? t("missing.desk.reportedNoName", { time: whenShort(t, one.createdAt) })
              : t("missing.desk.reported", { time: whenShort(t, one.createdAt), reporter: one.reporterName })}
          </li>
        </ul>
      </div>
      {one.contactNumber || one.personNumber ? (
        <div className="flex flex-wrap gap-3">
          {one.contactNumber ? (
            <a
              href={`tel:${one.contactNumber}`}
              className="inline-flex min-h-target-min items-center gap-2 font-semibold"
            >
              <Icon name="phone" className="size-5" />
              {t("missing.desk.callReporter", { number: spacedNumber(one.contactNumber) })}
            </a>
          ) : null}
          {one.personNumber ? (
            <a
              href={`tel:${one.personNumber}`}
              className="inline-flex min-h-target-min items-center gap-2 font-semibold"
            >
              <Icon name="phone" className="size-5" />
              {t("missing.desk.callPerson", { number: spacedNumber(one.personNumber) })}
            </a>
          ) : null}
        </div>
      ) : null}
      <details>
        <summary className="inline-flex min-h-target-min cursor-pointer items-center font-semibold">
          {t("missing.desk.history")}
        </summary>
        <ol className="mt-2 flex flex-col gap-1 text-meta">
          {one.history.map((entry) => (
            <li key={`${entry.status}-${entry.at.utc}`}>
              {entry.actor === null
                ? t("missing.desk.historyItem", {
                    status: t(`missing.status.${entry.status}`),
                    time: whenShort(t, entry.at),
                  })
                : t("missing.desk.historyBy", {
                    status: t(`missing.status.${entry.status}`),
                    time: whenShort(t, entry.at),
                    actor: entry.actor,
                  })}
              {entry.note ? <span className="block text-muted">{entry.note}</span> : null}
            </li>
          ))}
        </ol>
      </details>
      {one.name !== null ? (
        <Form method="post" className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
          <input type="hidden" name="id" value={one.id} />
          <label className="flex flex-col gap-1.5">
            <span className="font-semibold">{t("missing.desk.to")}</span>
            <select
              name="to"
              defaultValue={moves[0]}
              className="min-h-target rounded-control border border-control bg-surface px-3 text-ink"
            >
              {moves.map((to) => (
                <option key={to} value={to}>
                  {t(`missing.status.${to}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5">
            <label htmlFor={`note-${one.id}`} className="font-semibold">
              {t("missing.desk.note")}
              <span className="ms-2 font-normal text-muted">{t("missing.optional")}</span>
            </label>
            <Input id={`note-${one.id}`} name="note" maxLength={300} />
          </div>
          <Button variant="primary">{t("missing.desk.save")}</Button>
        </Form>
      ) : null}
    </li>
  );
}

// "Orang dicari": the region's missing persons, newest first, each moved by its own small form.
export function DeskMissingView({
  items,
  status,
  summary,
  saved,
  envelope,
}: {
  readonly items: readonly DeskMissingOne[];
  readonly status: MissingStatus | null;
  readonly summary: DeskSummary | null;
  readonly saved: boolean;
  readonly envelope: ErrorEnvelope | null;
}) {
  const t = useText();
  const filters: readonly (MissingStatus | null)[] = [null, ...MISSING_STATUSES];
  return (
    <DeskShell place={{ filters: ALL_FILTERS, current: null, summary }} account={summary?.account.label ?? ""}>
      <div className="flex flex-col gap-1">
        <h1 className="text-page font-bold">{t("missing.desk.title")}</h1>
        <p className="max-w-[65ch] text-muted">{t("missing.desk.lead")}</p>
      </div>
      {saved && envelope === null ? (
        <div role="status">
          <Notice kind="info">
            <p>{t("missing.desk.saved")}</p>
          </Notice>
        </div>
      ) : null}
      {envelope === null ? null : (
        <Notice kind={envelope.error.code.startsWith("limit.") ? "limit" : "error"}>
          <p>{limitText(t, envelope, Date.now())}</p>
        </Notice>
      )}
      <nav aria-label={t("missing.desk.filter")} className="flex flex-wrap gap-2">
        {filters.map((one) => (
          <Link
            key={one ?? "all"}
            to={one === null ? BASE : `${BASE}?status=${one}`}
            aria-current={one === status ? "page" : undefined}
            className="inline-flex min-h-target-min items-center rounded-control border border-line px-3 text-ink no-underline aria-[current=page]:border-primary aria-[current=page]:bg-selected aria-[current=page]:font-semibold"
          >
            {one === null ? t("missing.desk.all") : t(`missing.status.${one}`)}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="flex items-start gap-3 text-muted">
          <Icon name="inbox" className="mt-0.5" />
          {t("missing.desk.none")}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((one) => (
            <Person key={one.id} one={one} />
          ))}
        </ul>
      )}
    </DeskShell>
  );
}
