import { Form, useNavigation, useSearchParams } from "react-router";
import type { DeskPilot, DeskSummary } from "../../../../src/contract/desk";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { shortDate } from "../../../../src/copy/time";
import type { DeskTyped } from "../../../lib/deskTypes";
import { firstInvalid, problemOf } from "../../../lib/envelope";
import { useBusy, useFocusOnChange } from "../../../lib/hooks";
import { limitText } from "../../../lib/status";
import { useText } from "../../../lib/text";
import { Button } from "../../atoms/Button";
import { Input } from "../../atoms/controls";
import { Icon } from "../../atoms/Icon";
import { Field } from "../../molecules/Field";
import { Notice } from "../../molecules/Notice";
import { DeskShell } from "./DeskShell";
import { ALL_FILTERS, spacedNumber, whenShort } from "./parts";

type Item = DeskPilot["items"][number];

const SAVED = ["allowed", "removed"];
const FIELDS = ["number", "officerRegency"] as const;

// Taking a number away says what stops before the button that does it.
function Remove({ item }: { readonly item: Item }) {
  const t = useText();
  const navigation = useNavigation();
  const busy = navigation.formData?.get("key") === item.key;
  return (
    <details className="group md:col-start-4 md:row-start-1 md:open:col-span-full md:open:col-start-1 md:open:row-start-2">
      <summary
        aria-label={t("desk.pilot.removeOf", { number: spacedNumber(item.number) })}
        className="inline-flex min-h-target-min cursor-pointer list-none items-center rounded-control px-3 font-semibold text-danger hover:bg-danger-tint [&::-webkit-details-marker]:hidden"
      >
        {t("desk.pilot.remove")}
      </summary>
      <Form
        method="post"
        replace
        preventScrollReset
        className="mt-2 flex flex-col gap-3 rounded-control bg-danger-tint p-3 md:flex-row md:items-center md:justify-between md:gap-6"
      >
        <input type="hidden" name="action" value="remove" />
        <input type="hidden" name="key" value={item.key} />
        <p className="max-w-[60ch]">{t("desk.pilot.remove.body")}</p>
        <Button variant="danger" className="shrink-0" busyLabel={busy ? t("desk.pilot.remove.busy") : null}>
          {t("desk.pilot.remove.accept")}
        </Button>
      </Form>
    </details>
  );
}

function Row({ item }: { readonly item: Item }) {
  const t = useText();
  return (
    <li className="grid gap-x-6 gap-y-2 px-4 py-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_auto] md:items-center md:px-5">
      <span className="flex min-w-0 flex-col items-start gap-1">
        <span className="font-semibold whitespace-nowrap tabular-nums">{spacedNumber(item.number)}</span>
        <span className="text-meta text-muted break-words">
          {item.officerRegency === null
            ? t("desk.pilot.citizen")
            : t("desk.pilot.officer", { regency: item.officerRegency })}
        </span>
      </span>
      <span className="flex min-w-0 flex-col text-meta text-muted">
        <span className="break-words">{t("desk.pilot.addedBy", { label: item.addedBy })}</span>
        <span className="tabular-nums">{whenShort(t, item.addedAt)}</span>
      </span>
      <span className="flex min-w-0 flex-col tabular-nums">
        {item.lastReportAt === null ? (
          <span className="text-meta text-muted">{t("desk.pilot.noReports")}</span>
        ) : (
          <>
            <span className="font-semibold">{t("desk.pilot.reports", { count: item.reports })}</span>
            <span className="text-meta text-muted">{t("desk.pilot.last", { at: shortDate(item.lastReportAt) })}</span>
          </>
        )}
      </span>
      <Remove item={item} />
    </li>
  );
}

function AddNumber({ envelope, typed }: { readonly envelope: ErrorEnvelope | null; readonly typed: DeskTyped | null }) {
  const t = useText();
  const busy = useBusy("add", "action");
  const invalid = firstInvalid(envelope, FIELDS);
  useFocusOnChange(invalid, envelope);
  return (
    <section aria-labelledby="pilot-add" className="flex flex-col gap-4 card-surface p-4 md:p-5">
      <h2 id="pilot-add" className="text-card font-bold">
        {t("desk.pilot.add.title")}
      </h2>
      <Form method="post" preventScrollReset className="flex flex-col gap-4">
        <input type="hidden" name="action" value="add" />
        <Field
          id="number"
          label={t("desk.pilot.number")}
          hint={t("desk.pilot.numberHint")}
          problem={problemOf(envelope, "number")}
          focus={invalid === "number"}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="tel"
              autoComplete="off"
              required
              defaultValue={typed?.values.number}
              className="tabular-nums"
            />
          )}
        </Field>
        <Field
          id="officerRegency"
          label={t("desk.pilot.regency")}
          hint={t("desk.pilot.regencyHint")}
          problem={problemOf(envelope, "officerRegency")}
          focus={invalid === "officerRegency"}
        >
          {(control) => <Input {...control} autoComplete="off" defaultValue={typed?.values.officerRegency} />}
        </Field>
        <Button variant="primary" busyLabel={busy ? t("desk.pilot.add.busy") : null}>
          {t("desk.pilot.add")}
        </Button>
      </Form>
    </section>
  );
}

// The numbers the WhatsApp pilot serves: the list, and the form that adds to it.
export function DeskPilotView({
  pilot,
  summary,
  envelope = null,
  typed = null,
}: {
  readonly pilot: DeskPilot;
  readonly summary: DeskSummary | null;
  readonly envelope?: ErrorEnvelope | null;
  readonly typed?: DeskTyped | null;
}) {
  const t = useText();
  const [search] = useSearchParams();
  const saved = search.get("saved");
  const { items, max } = pilot;
  return (
    <DeskShell place={{ filters: ALL_FILTERS, current: null, summary }} account={pilot.account.label}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-page font-bold">{t("desk.pilot.title")}</h1>
          <p className="max-w-[65ch] text-muted">{t("desk.pilot.lead")}</p>
        </div>
        <p className="font-semibold tabular-nums">{t("desk.pilot.count", { count: items.length, max })}</p>
      </div>
      {envelope === null && saved !== null && SAVED.includes(saved) ? (
        <div role="status">
          <Notice kind="info">
            <p>{t(`desk.pilot.saved.${saved}`)}</p>
          </Notice>
        </div>
      ) : null}
      {envelope !== null && envelope.fields.length === 0 ? (
        <Notice kind={envelope.error.code.startsWith("limit.") ? "limit" : "error"}>
          <p>{limitText(t, envelope, Date.now())}</p>
        </Notice>
      ) : null}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <section aria-labelledby="pilot-list" className="order-2 overflow-hidden card-surface xl:order-1">
          <h2 id="pilot-list" className="border-b border-line px-4 py-4 text-card font-bold md:px-5">
            {t("desk.pilot.list")}
          </h2>
          {items.length === 0 ? (
            <p className="flex items-start gap-3 px-4 py-6 text-muted md:px-5">
              <Icon name="inbox" className="mt-0.5" />
              <span className="max-w-[60ch]">{t("desk.pilot.empty")}</span>
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <Row key={item.key} item={item} />
              ))}
            </ul>
          )}
        </section>
        <div className="order-1 xl:sticky xl:top-7 xl:order-2">
          <AddNumber envelope={envelope} typed={typed} />
        </div>
      </div>
    </DeskShell>
  );
}
