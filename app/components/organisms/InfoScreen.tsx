import { Form, Link } from "react-router";
import type { OutlookView } from "../../../src/contract/outlook";
import { cn } from "../../lib/cn";
import { useText } from "../../lib/text";
import { Button, buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { CallRow } from "../molecules/CallRow";
import { Notice } from "../molecules/Notice";

type Regency = { readonly code: string; readonly name: string; readonly provinceName: string };
type Day = OutlookView["days"][number];
type Level = Day["threats"][number]["level"];

export type InfoLoad =
  | { readonly kind: "start" | "short" | "unavailable" | "none"; readonly query: string }
  | { readonly kind: "results"; readonly query: string; readonly regencies: readonly Regency[] }
  | { readonly kind: "outlook"; readonly query: string; readonly outlook: OutlookView };

// The word always shows; the colour only repeats it.
const LEVEL_STYLE: Record<Level, string> = {
  0: "bg-sunken text-ink",
  1: "bg-warn-tint text-ink",
  2: "bg-siaga text-on-siaga",
  3: "bg-signal text-on-signal",
};

const dayName = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const madeTime = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" });

function LevelTag({ level }: { readonly level: Level }) {
  const t = useText();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-control px-2 text-meta font-semibold",
        LEVEL_STYLE[level],
      )}
    >
      {t(`info.level.${level}`)}
    </span>
  );
}

function DayCard({ day }: { readonly day: Day }) {
  const t = useText();
  return (
    <li className="flex flex-col gap-3 card-surface p-4">
      <h3 className="font-bold">{dayName.format(Date.parse(day.date))}</h3>
      <p className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2">
          <Icon name="droplets" className="size-5 text-muted" />
          {day.rainMm === null ? t("info.day.rainUnknown") : t("info.day.rain", { mm: day.rainMm })}
        </span>
        {day.rainLevel === null ? null : <LevelTag level={day.rainLevel} />}
      </p>
      {day.threats.length === 0 ? (
        <p className="text-meta text-muted">{t("info.day.calm")}</p>
      ) : (
        <ul aria-label={t("info.day.threats")} className="flex flex-col gap-2 border-t border-line pt-3">
          {day.threats.map((threat) => (
            <li key={threat.code} className="flex items-center justify-between gap-2">
              {threat.label}
              <LevelTag level={threat.level} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Calls({ contact }: { readonly contact: OutlookView["contact"] | null }) {
  const t = useText();
  return (
    <section aria-labelledby="info-call" className="flex flex-col gap-3">
      <h2 id="info-call" className="text-card font-bold">
        {t("info.call.title")}
      </h2>
      <CallRow number="112" label={t("emergency.call112")} first />
      <CallRow number="117" label={t("emergency.call117")} />
      {contact && contact.level !== "national" ? (
        <CallRow number={contact.phone} label={t("emergency.callBpbd", { name: contact.name })} />
      ) : null}
    </section>
  );
}

function Outlook({ outlook }: { readonly outlook: OutlookView }) {
  const t = useText();
  return (
    <>
      <section aria-labelledby="info-outlook" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="info-outlook" className="text-card font-bold">
              {t("info.outlook.title", { regency: outlook.regencyName })}
            </h2>
            <p className="text-meta text-muted">
              {t("info.outlook.area", { province: outlook.provinceName })}.{" "}
              {t("info.outlook.madeAt", { time: madeTime.format(Date.parse(outlook.madeAt)) })}
            </p>
          </div>
          <Link to="/lapor/info" className={buttonStyles({ variant: "secondary", size: "min" })}>
            {t("info.outlook.change")}
          </Link>
        </div>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {outlook.days.map((day) => (
            <DayCard key={day.date} day={day} />
          ))}
        </ul>
        {outlook.advice.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-bold">{t("info.advice.title")}</h3>
            <ul className="flex flex-col gap-1">
              {outlook.advice.map((one) => (
                <li key={`${one.date}${one.text}`}>
                  <span className="font-semibold">{dayName.format(Date.parse(one.date))}</span>: {one.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-meta text-muted">{t("info.note")}</p>
      </section>
      <Calls contact={outlook.contact} />
    </>
  );
}

function Results({ regencies, query }: { readonly regencies: readonly Regency[]; readonly query: string }) {
  const t = useText();
  if (regencies.length === 0) return <Notice kind="info">{t("info.search.none", { query })}</Notice>;
  return (
    <section aria-labelledby="info-results" className="flex flex-col gap-2">
      <h2 id="info-results" className="text-meta font-semibold text-muted">
        {t("info.search.results")}
      </h2>
      <ul className="flex flex-col gap-2">
        {regencies.map((regency) => (
          <li key={regency.code}>
            <Link
              to={`/lapor/info?kab=${regency.code}`}
              className="flex min-h-target items-center justify-between gap-3 rounded-control border border-line bg-surface px-4 py-2 text-ink no-underline hover:border-control"
            >
              {t("info.search.regency", { name: regency.name, province: regency.provinceName })}
              <Icon name="chevronRight" className="size-5 shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// A regency's three days, read on the server so it opens with no script (K87).
export function InfoScreen({ load }: { readonly load: InfoLoad }) {
  const t = useText();
  return (
    <>
      {load.kind === "outlook" ? null : (
        <Form method="get" action="/lapor/info" className="flex max-w-xl flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="font-semibold">{t("info.search.label")}</span>
            <input
              name="q"
              type="search"
              defaultValue={load.query}
              minLength={3}
              maxLength={60}
              className="min-h-target rounded-control border border-control bg-surface px-3 text-ink"
            />
          </label>
          <Button variant="primary">{t("info.search.submit")}</Button>
        </Form>
      )}
      {load.kind === "short" ? <Notice kind="info">{t("info.search.short")}</Notice> : null}
      {load.kind === "unavailable" ? <Notice kind="error">{t("info.unavailable")}</Notice> : null}
      {load.kind === "none" ? <Notice kind="info">{t("info.none")}</Notice> : null}
      {load.kind === "results" ? <Results regencies={load.regencies} query={load.query} /> : null}
      {load.kind === "outlook" ? <Outlook outlook={load.outlook} /> : <Calls contact={null} />}
    </>
  );
}
