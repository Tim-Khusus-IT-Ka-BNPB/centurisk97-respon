import { Form, Link, useSearchParams } from "react-router";
import type { DeskResponse, DeskSummary } from "../../../../src/contract/desk";
import type { WarningControl } from "../../../../src/contract/warnings";
import type { Text } from "../../../../src/copy/text";
import { monthText } from "../../../../src/copy/time";
import { useText } from "../../../lib/text";
import { buttonStyles } from "../../atoms/Button";
import { Icon } from "../../atoms/Icon";
import { FileFrame, useFileTarget } from "../../molecules/FileFrame";
import { Notice } from "../../molecules/Notice";
import { DeskShell } from "./DeskShell";
import { ALL_FILTERS } from "./parts";

type Agency = DeskResponse["agencies"][number];
type Spread = NonNullable<Agency["figures"]>["seen"];
type Ease = NonNullable<Agency["figures"]>["ease"];

// Minutes as a person reads them: under an hour in minutes, else hours and minutes.
const minutesText = (t: Text, minutes: number) =>
  minutes < 60
    ? t("desk.response.minutes", { minutes })
    : t("desk.response.hours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });

// The month before or after "YYYY-MM".
export function monthStep(month: string, step: -1 | 1): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, number - 1 + step, 1)).toISOString().slice(0, 7);
}

function Figure({ spread, missing }: { readonly spread: Spread; readonly missing: number }) {
  const t = useText();
  return (
    <span className="flex flex-col gap-0.5">
      {spread === null ? (
        <span className="text-muted">{t("desk.response.none")}</span>
      ) : (
        <>
          <span className="font-semibold tabular-nums">{minutesText(t, spread.median)}</span>
          <span className="text-meta text-muted tabular-nums">
            {t("desk.response.p90", { time: minutesText(t, spread.p90) })}
          </span>
        </>
      )}
      {missing > 0 ? (
        <span className="text-meta text-muted tabular-nums">{t("desk.response.missing", { count: missing })}</span>
      ) : null}
    </span>
  );
}

// How easy the reporters found reporting, as they answered after sending: never a mark of the BPBD.
function EaseFigure({ ease }: { readonly ease: Ease }) {
  const t = useText();
  if (ease === null) return <span className="text-muted">{t("desk.response.ease.tooFew")}</span>;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-semibold tabular-nums">{t("desk.response.ease", { average: ease.average })}</span>
      <span className="text-meta text-muted tabular-nums">{t("desk.response.ease.count", { count: ease.count })}</span>
    </span>
  );
}

const cell = "border-t border-line px-4 py-3.5 align-top";

function AgencyRow({ agency }: { readonly agency: Agency }) {
  const t = useText();
  const { figures } = agency;
  return (
    <tr>
      <th scope="row" className={`${cell} text-start font-semibold`}>
        {t("desk.response.agency", { regency: agency.regencyName })}
      </th>
      <td className={`${cell} tabular-nums`}>{agency.reports.toLocaleString("id-ID")}</td>
      {figures === null ? (
        <td colSpan={3} className={`${cell} text-muted`}>
          {t("desk.response.tooFew")}
        </td>
      ) : (
        <>
          <td className={cell}>
            <Figure spread={figures.seen} missing={figures.notSeen} />
          </td>
          <td className={cell}>
            <Figure spread={figures.taken} missing={figures.notTaken} />
          </td>
          <td className={cell}>
            <EaseFigure ease={figures.ease} />
          </td>
        </>
      )}
    </tr>
  );
}

// The weekly counts for research (K62): one file of every report, small cells hidden, each
// download logged.
function Aggregates() {
  const t = useText();
  const target = useFileTarget();
  const [search] = useSearchParams();
  return (
    <section aria-labelledby="desk-aggregates" className="flex flex-col gap-3 card-surface p-5 md:p-6">
      <h2 id="desk-aggregates" className="text-section font-bold tracking-[-0.015em]">
        {t("desk.aggregates.title")}
      </h2>
      <p className="max-w-[65ch] text-muted">{t("desk.aggregates.lead")}</p>
      {search.get("refused") === "aggregates" ? (
        <Notice kind="error">
          <p>{t("desk.aggregates.refused")}</p>
        </Notice>
      ) : null}
      <Form reloadDocument method="post" action="/desk/response/aggregates" target={target}>
        <button type="submit" className={buttonStyles({ variant: "secondary", size: "min", className: "px-4" })}>
          <Icon name="download" className="size-5" />
          {t("desk.aggregates.download")}
        </button>
      </Form>
      <FileFrame />
    </section>
  );
}

const pausedAt = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" });

// The warnings to phones (M07): staff pause them, and the next run sends nothing.
function Warnings({ warnings }: { readonly warnings: WarningControl | null }) {
  const t = useText();
  const [search] = useSearchParams();
  return (
    <section aria-labelledby="desk-warnings" className="flex flex-col gap-3 card-surface p-5 md:p-6">
      <h2 id="desk-warnings" className="text-section font-bold tracking-[-0.015em]">
        {t("desk.warnings.title")}
      </h2>
      {search.get("refused") === "warnings" ? (
        <Notice kind="error">
          <p>{t("desk.warnings.refused")}</p>
        </Notice>
      ) : null}
      {warnings === null ? (
        <p className="text-muted">{t("desk.warnings.unavailable")}</p>
      ) : (
        <>
          <p className="max-w-[65ch]">
            {!warnings.open
              ? t("desk.warnings.shut")
              : warnings.paused
                ? t("desk.warnings.paused", {
                    by: warnings.by as string,
                    at: pausedAt.format(Date.parse(warnings.at as string)),
                  })
                : t("desk.warnings.running")}{" "}
            {t("desk.warnings.phones", { count: warnings.phones })}
          </p>
          {warnings.open ? (
            <Form method="post">
              <input type="hidden" name="paused" value={warnings.paused ? "0" : "1"} />
              <button type="submit" className={buttonStyles({ variant: "secondary", size: "min", className: "px-4" })}>
                <Icon name={warnings.paused ? "bell" : "bellOff"} className="size-5" />
                {warnings.paused ? t("desk.warnings.resume") : t("desk.warnings.pause")}
              </button>
            </Form>
          ) : null}
        </>
      )}
    </section>
  );
}

// How fast each agency answered a month's reports. By name, never ranked.
export function DeskResponseView({
  response,
  summary,
  warnings,
}: {
  readonly response: DeskResponse;
  readonly summary: DeskSummary | null;
  readonly warnings: WarningControl | null;
}) {
  const t = useText();
  const { month } = response;
  return (
    <DeskShell place={{ filters: ALL_FILTERS, current: null, summary }} account={response.account.label}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-page font-bold">{t("desk.response.title")}</h1>
          <p className="max-w-[65ch] text-muted">{t("desk.response.lead")}</p>
        </div>
        <nav
          aria-label={t("desk.response.months")}
          className="flex items-center gap-1 rounded-control border border-line bg-surface p-0.5"
        >
          <Link
            to={`/desk/response?month=${monthStep(month, -1)}`}
            aria-label={t("desk.response.before")}
            className={buttonStyles({ variant: "link", size: "min", className: "px-3" })}
          >
            <Icon name="chevronRight" className="size-5 rotate-180" />
          </Link>
          <span className="min-w-36 text-center font-semibold">{monthText(month)}</span>
          <Link
            to={`/desk/response?month=${monthStep(month, 1)}`}
            aria-label={t("desk.response.after")}
            className={buttonStyles({ variant: "link", size: "min", className: "px-3" })}
          >
            <Icon name="chevronRight" className="size-5" />
          </Link>
        </nav>
      </div>
      {response.agencies.length === 0 ? (
        <Notice kind="info">
          <p>{t("desk.response.empty")}</p>
        </Notice>
      ) : (
        <div className="overflow-x-auto card-surface">
          <table className="w-full min-w-[42rem] border-separate border-spacing-0 text-start">
            <thead>
              <tr className="bg-sunken/60 text-meta text-muted">
                {(["agency", "reports", "seen", "taken", "ease"] as const).map((column) => (
                  <th key={column} scope="col" className="px-4 py-3 text-start font-semibold">
                    {t(`desk.response.col.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {response.agencies.map((agency) => (
                <AgencyRow key={agency.regencyCode} agency={agency} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-meta text-muted">{t("desk.response.method")}</p>
      <p className="text-meta text-muted">{t("desk.response.ease.hint")}</p>
      <Aggregates />
      <Warnings warnings={warnings} />
    </DeskShell>
  );
}
