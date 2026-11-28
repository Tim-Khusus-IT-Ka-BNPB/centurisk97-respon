import type { ReactNode } from "react";
import { Form, Link } from "react-router";
import type { DeskSummary } from "../../../../src/contract/desk";
import type { DeskBpbdNumbers, DeskFacilityNumbers } from "../../../../src/contract/numbers";
import type { Text } from "../../../../src/copy/text";
import type { Instant } from "../../../../src/copy/time";
import { FACILITY_KINDS } from "../../../../src/domain/facilities";
import { CONTACT_KINDS } from "../../../../src/domain/numbersEdit";
import { isLimit } from "../../../lib/envelope";
import { type NumbersSaved, type NumbersView, numbersLink } from "../../../lib/numbersView";
import { limitText } from "../../../lib/status";
import { useText } from "../../../lib/text";
import { buttonStyles } from "../../atoms/Button";
import { Input, Label, Select } from "../../atoms/controls";
import { Icon } from "../../atoms/Icon";
import { Notice } from "../../molecules/Notice";
import { Pagination } from "../../molecules/Pagination";
import { FacilityForm, NumberForm, type NumbersRefused, RemoveForm } from "./DeskNumberForms";
import { DeskShell } from "./DeskShell";
import { ALL_FILTERS, whenShort } from "./parts";

const TABS = ["bpbd", "facilities"] as const;

// A kind the file names that the desk does not know is shown as the file writes it.
const kindText = (t: Text, jenis: string) =>
  (CONTACT_KINDS as readonly string[]).includes(jenis) ? t(`desk.numbers.kind.${jenis}`) : jenis;

const summaryButton = `${buttonStyles({ variant: "secondary", size: "min" })} cursor-pointer list-none [&::-webkit-details-marker]:hidden`;

// A step that opens under its own button: a change, a removal, an addition. It opens by itself when
// the server sent its form back.
function Step({
  label,
  of,
  open,
  children,
}: {
  readonly label: string;
  // What the step is about, said to a screen reader after the label.
  readonly of?: string;
  readonly open: boolean;
  readonly children: ReactNode;
}) {
  return (
    <details open={open} className="group min-w-0 open:basis-full">
      <summary className={summaryButton}>
        {label}
        {of ? <span className="sr-only"> {of}</span> : null}
      </summary>
      <div className="mt-3 rounded-control border border-line p-4">{children}</div>
    </details>
  );
}

const openFor = (refused: NumbersRefused, formKey: string) => refused?.typed.values.form === formKey;

function Search({ view }: { readonly view: NumbersView }) {
  const t = useText();
  return (
    <Form method="get" className="flex flex-wrap items-end gap-3">
      {view.tab === "facilities" ? <input type="hidden" name="tab" value="facilities" /> : null}
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
        <Label htmlFor="numbers-q">{t(`desk.numbers.search.${view.tab}`)}</Label>
        <Input id="numbers-q" name="q" type="search" maxLength={60} defaultValue={view.search.q} />
      </div>
      {view.tab === "bpbd" ? (
        <label className="flex min-h-target items-center gap-3">
          <input
            type="checkbox"
            name="empty"
            value="1"
            defaultChecked={view.search.empty}
            className="size-5 shrink-0 accent-primary"
          />
          {t("desk.numbers.search.empty")}
        </label>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="numbers-kind">{t("desk.numbers.search.kind")}</Label>
          <Select id="numbers-kind" name="kind" defaultValue={view.search.kind ?? ""}>
            <option value="">{t("desk.numbers.search.allKinds")}</option>
            {FACILITY_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`desk.numbers.facility.kind.${kind}`)}
              </option>
            ))}
          </Select>
        </div>
      )}
      <button type="submit" className={buttonStyles({ variant: "secondary" })}>
        <Icon name="search" />
        {t("desk.numbers.search.submit")}
      </button>
    </Form>
  );
}

function Pages({ view }: { readonly view: NumbersView }) {
  const t = useText();
  const { page, pages } = view.list;
  return (
    <Pagination
      page={page}
      pages={pages}
      hrefFor={(to) => numbersLink({ tab: view.tab, ...view.search }, to)}
      labels={{
        summary: t("desk.numbers.page", { page, pages }),
        previous: t("desk.numbers.previous"),
        next: t("desk.numbers.next"),
      }}
    />
  );
}

type Area = DeskBpbdNumbers["areas"][number];

function areaPlace(t: Text, area: Area): string {
  if (area.provinceName === "") return t("desk.numbers.level.unknown", { code: area.code });
  return area.level === "province"
    ? t("desk.numbers.level.province")
    : t("desk.numbers.level.regency", { province: area.provinceName });
}

function AreaCard({
  area,
  checksum,
  refused,
}: {
  readonly area: Area;
  readonly checksum: string | null;
  readonly refused: NumbersRefused;
}) {
  const t = useText();
  const base = { tab: "bpbd" as const, checksum, code: area.code };
  const adding = `add-${area.code}`;
  return (
    <li id={`wilayah-${area.code}`} className="flex scroll-mt-6 flex-col gap-3 card-surface p-4 md:p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-card font-bold break-words">{area.name}</h2>
        <p className="text-meta text-muted">{areaPlace(t, area)}</p>
      </div>
      {area.numbers.length === 0 ? (
        <p className="text-muted">
          {t(area.level === "province" ? "desk.numbers.area.emptyProvince" : "desk.numbers.area.emptyRegency")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {area.numbers.map((one) => {
            const key = `${area.code}-${one.index}`;
            return (
              <li key={key} className="flex flex-col gap-2 py-3 first:pt-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <a href={`tel:${one.nomor.replace(/[^\d+]/g, "")}`} className="font-semibold tabular-nums">
                    {one.nomor}
                  </a>
                  <span className="text-meta">{kindText(t, one.jenis)}</span>
                  {one.lama ? (
                    <span className="rounded-control bg-sunken px-2 py-0.5 text-meta">{t("desk.numbers.old")}</span>
                  ) : null}
                  {one.url === null ? null : (
                    <a href={one.url} rel="noreferrer noopener" target="_blank" className="text-meta">
                      {t("desk.numbers.source")}
                    </a>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Step label={t("desk.numbers.change")} of={one.nomor} open={openFor(refused, `change-${key}`)}>
                    <NumberForm
                      base={{ ...base, formKey: `change-${key}`, index: one.index }}
                      number={one}
                      refused={refused}
                      submit={t("desk.numbers.save")}
                    />
                  </Step>
                  <Step label={t("desk.numbers.remove")} of={one.nomor} open={false}>
                    <RemoveForm
                      base={{ ...base, formKey: `remove-${key}`, index: one.index }}
                      question={t("desk.numbers.removeAsk", { number: one.nomor, area: area.name })}
                      confirm={t("desk.numbers.removeConfirm")}
                    />
                  </Step>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Step label={t("desk.numbers.add")} of={area.name} open={openFor(refused, adding)}>
        <NumberForm
          base={{ ...base, formKey: adding }}
          number={null}
          refused={refused}
          submit={t("desk.numbers.add")}
        />
      </Step>
    </li>
  );
}

function BpbdList({
  view,
  refused,
}: {
  readonly view: Extract<NumbersView, { tab: "bpbd" }>;
  readonly refused: NumbersRefused;
}) {
  const t = useText();
  const { list } = view;
  return (
    <>
      <p className="text-muted">{t("desk.numbers.count.bpbd", { count: list.total.toLocaleString("id-ID") })}</p>
      {list.areas.length === 0 ? (
        <p className="flex items-start gap-3 text-muted">
          <Icon name="inbox" className="mt-0.5" />
          {t("desk.numbers.none.bpbd")}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {list.areas.map((area) => (
            <AreaCard key={area.code} area={area} checksum={list.checksum} refused={refused} />
          ))}
        </ul>
      )}
    </>
  );
}

type Facility = DeskFacilityNumbers["facilities"][number];

function FacilityCard({
  one,
  checksum,
  refused,
}: {
  readonly one: Facility;
  readonly checksum: string | null;
  readonly refused: NumbersRefused;
}) {
  const t = useText();
  const base = { tab: "facilities" as const, checksum, index: one.index };
  const changing = `change-${one.index}`;
  return (
    <li id={`fasilitas-${one.index}`} className="flex scroll-mt-6 flex-col gap-3 card-surface p-4 md:p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-card font-bold break-words">{one.name}</h2>
        <p className="text-meta text-muted">
          {t(`desk.numbers.facility.kind.${one.kind}`)},{" "}
          {t("desk.numbers.facility.at", {
            lat: one.lat.toLocaleString("id-ID", { maximumFractionDigits: 6 }),
            lon: one.lon.toLocaleString("id-ID", { maximumFractionDigits: 6 }),
          })}
        </p>
      </div>
      <a href={`tel:${one.phone}`} className="w-fit font-semibold tabular-nums">
        {one.phone}
      </a>
      <div className="flex flex-wrap gap-2">
        <Step label={t("desk.numbers.change")} of={one.name} open={openFor(refused, changing)}>
          <FacilityForm
            base={{ ...base, formKey: changing }}
            facility={one}
            refused={refused}
            submit={t("desk.numbers.facility.save")}
          />
        </Step>
        <Step label={t("desk.numbers.remove")} of={one.name} open={false}>
          <RemoveForm
            base={{ ...base, formKey: `remove-${one.index}` }}
            question={t("desk.numbers.facility.removeAsk", { name: one.name })}
            confirm={t("desk.numbers.facility.removeConfirm")}
          />
        </Step>
      </div>
    </li>
  );
}

function FacilityList({
  view,
  refused,
}: {
  readonly view: Extract<NumbersView, { tab: "facilities" }>;
  readonly refused: NumbersRefused;
}) {
  const t = useText();
  const { list } = view;
  return (
    <>
      <Step label={t("desk.numbers.facility.add")} open={openFor(refused, "add")}>
        <FacilityForm
          base={{ tab: "facilities", checksum: list.checksum, formKey: "add" }}
          facility={null}
          refused={refused}
          submit={t("desk.numbers.facility.add")}
        />
      </Step>
      <p className="text-muted">{t("desk.numbers.count.facilities", { count: list.total.toLocaleString("id-ID") })}</p>
      {list.facilities.length === 0 ? (
        <p className="flex items-start gap-3 text-muted">
          <Icon name="inbox" className="mt-0.5" />
          {t("desk.numbers.none.facilities")}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {list.facilities.map((one) => (
            <FacilityCard key={one.index} one={one} checksum={list.checksum} refused={refused} />
          ))}
        </ul>
      )}
    </>
  );
}

type Change<T> =
  | {
      readonly id: number;
      readonly at: Instant;
      readonly change: "added" | "changed" | "removed";
      readonly by: string;
      readonly entry: string;
      readonly before: T | null;
      readonly after: T | null;
    }
  | { readonly id: number; readonly at: Instant; readonly change: "imported" };

const AREA_LINES = { added: "added", changed: "changed", removed: "removed" } as const;
const FACILITY_LINES = { added: "facilityAdded", changed: "facilityChanged", removed: "facilityRemoved" } as const;

// The latest changes, newest first: who did what to which entry, as a sentence.
function History<T>({
  changes,
  lines,
  entryText,
}: {
  readonly changes: readonly Change<T>[];
  readonly lines: typeof AREA_LINES | typeof FACILITY_LINES;
  readonly entryText: (entry: T | null) => string;
}) {
  const t = useText();
  const line = (one: Change<T>) => {
    if (one.change === "imported") return t("desk.numbers.history.imported");
    return t(`desk.numbers.history.${lines[one.change]}`, {
      who: one.by,
      entry: one.entry,
      before: entryText(one.before),
      after: entryText(one.after),
    });
  };
  return (
    <section aria-labelledby="numbers-history" className="flex flex-col gap-2 border-t border-line pt-5">
      <h2 id="numbers-history" className="text-card font-bold">
        {t("desk.numbers.history.title")}
      </h2>
      {changes.length === 0 ? (
        <p className="text-muted">{t("desk.numbers.history.none")}</p>
      ) : (
        <>
          <p className="text-meta text-muted">{t("desk.numbers.history.lead")}</p>
          <ol className="flex flex-col gap-2">
            {changes.map((one) => (
              <li key={one.id} className="flex flex-col">
                <span className="text-meta text-muted">{whenShort(t, one.at)}</span>
                <span>{line(one)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

// "Nomor BPBD dan fasilitas": the numbers a reporter is shown, kept by BNPB one entry at a time.
export function DeskNumbersView({
  view,
  summary,
  saved,
  refused,
}: {
  readonly view: NumbersView;
  readonly summary: DeskSummary | null;
  readonly saved: NumbersSaved | null;
  readonly refused: NumbersRefused;
}) {
  const t = useText();
  return (
    <DeskShell place={{ filters: ALL_FILTERS, current: null, summary }} account={summary?.account.label ?? ""}>
      <div className="flex flex-col gap-1">
        <h1 className="text-page font-bold">{t("desk.numbers.title")}</h1>
        <p className="max-w-[65ch] text-muted">{t("desk.numbers.lead")}</p>
      </div>
      <nav aria-label={t("desk.numbers.tabs")} className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab}
            to={numbersLink({ tab, q: "" })}
            aria-current={tab === view.tab ? "page" : undefined}
            className="inline-flex min-h-target-min items-center rounded-control border border-line px-3 text-ink no-underline aria-[current=page]:border-primary aria-[current=page]:bg-selected aria-[current=page]:font-semibold"
          >
            {t(`desk.numbers.tab.${tab}`)}
          </Link>
        ))}
      </nav>
      {saved !== null && refused === null ? (
        <div role="status">
          <Notice kind="info">
            <p>{t(`desk.numbers.saved.${saved}`)}</p>
          </Notice>
        </div>
      ) : null}
      {refused === null ? null : (
        <Notice kind={isLimit(refused.envelope) ? "limit" : "error"}>
          <p>{limitText(t, refused.envelope, Date.now())}</p>
        </Notice>
      )}
      <Search view={view} />
      {/* Keyed by the file's version, so a kept edit closes its form and clears what was typed. */}
      {view.tab === "bpbd" ? (
        <BpbdList key={view.list.checksum} view={view} refused={refused} />
      ) : (
        <FacilityList key={view.list.checksum} view={view} refused={refused} />
      )}
      <Pages view={view} />
      {view.tab === "bpbd" ? (
        <History
          changes={view.list.changes}
          lines={AREA_LINES}
          entryText={(one) =>
            one === null ? "" : t("desk.numbers.history.number", { nomor: one.nomor, kind: kindText(t, one.jenis) })
          }
        />
      ) : (
        <History
          changes={view.list.changes}
          lines={FACILITY_LINES}
          entryText={(one) =>
            one === null
              ? ""
              : t("desk.numbers.history.facility", {
                  name: one.name,
                  kind: t(`desk.numbers.facility.kind.${one.kind}`),
                  phone: one.phone,
                })
          }
        />
      )}
    </DeskShell>
  );
}
