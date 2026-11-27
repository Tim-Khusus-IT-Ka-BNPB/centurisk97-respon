import { Form, Link } from "react-router";
import type { PlaceResults } from "../../../src/contract/card";
import { qrModules, qrPath } from "../../../src/domain/qr";
import { useHydrated } from "../../lib/hooks";
import { useText } from "../../lib/text";
import { Button, buttonStyles } from "../atoms/Button";
import { Emblem } from "../atoms/Emblem";
import { Icon } from "../atoms/Icon";
import { Notice } from "../molecules/Notice";

type Item = PlaceResults["items"][number];

export type PosterLoad =
  | { readonly kind: "start"; readonly query: string }
  | { readonly kind: "short"; readonly query: string }
  | { readonly kind: "unavailable"; readonly query: string }
  | { readonly kind: "results"; readonly query: string; readonly items: readonly Item[] }
  | {
      readonly kind: "sheets";
      readonly query: string;
      readonly area: { readonly name: string; readonly regencyName: string };
      readonly district: string;
      readonly villages: readonly Item[];
      // One village picked from the district.
      readonly one: boolean;
      // The district has more villages than one list holds.
      readonly cut: boolean;
    };

// The address a poster's code opens: the report, with the village's ten digits (D131).
export const posterLink = (origin: string, code: string) => `${origin}/report?village=${code.replace(/\D/g, "")}`;

function Sheet({ village, origin }: { readonly village: Item; readonly origin: string }) {
  const t = useText();
  const modules = qrModules(posterLink(origin, village.code));
  const size = modules.length + 8;
  return (
    <article
      aria-label={t("poster.sheet.village", { name: village.name })}
      className="mx-auto flex w-full max-w-[42rem] flex-col items-center gap-5 rounded-card border border-line bg-white p-8 text-center text-black print:h-[275mm] print:max-w-none print:justify-center print:gap-8 print:break-after-page print:rounded-none print:border-0 print:p-0"
    >
      <div className="flex items-center gap-3">
        <Emblem className="size-14 print:size-20" />
        <span className="text-left text-lg font-bold print:text-2xl">{t("poster.sheet.brand")}</span>
      </div>
      <h2 className="text-3xl font-extrabold tracking-[-0.02em] text-balance print:text-5xl">
        {t("poster.sheet.title")}
      </h2>
      <div className="flex flex-col gap-1">
        <p className="text-2xl font-bold print:text-4xl">{t("poster.sheet.village", { name: village.name })}</p>
        <p className="text-lg print:text-2xl">
          {t("poster.sheet.area", {
            district: village.districtName as string,
            regency: village.regencyName,
            province: village.provinceName,
          })}
        </p>
      </div>
      <svg
        role="img"
        aria-label={t("poster.sheet.qr", { name: village.name })}
        viewBox={`0 0 ${size} ${size}`}
        shapeRendering="crispEdges"
        className="aspect-square h-auto w-72 max-w-full bg-white print:w-[115mm]"
      >
        <path d={qrPath(modules)} fill="#000" />
      </svg>
      <p className="max-w-[36ch] text-lg print:text-2xl">{t("poster.sheet.scan")}</p>
      <div className="flex flex-col gap-1 border-t border-black/30 pt-4 text-lg print:text-2xl">
        <p className="font-bold">{t("poster.sheet.lifeLine")}</p>
        <p>{t("poster.sheet.callCenter")}</p>
      </div>
    </article>
  );
}

function Results({ items, query }: { readonly items: readonly Item[]; readonly query: string }) {
  const t = useText();
  const shown = items.filter((item) => item.level !== "regency");
  if (shown.length === 0) return <Notice kind="info">{t("poster.search.none", { query })}</Notice>;
  return (
    <section aria-labelledby="poster-results" className="flex flex-col gap-2">
      <h2 id="poster-results" className="text-meta font-semibold text-muted">
        {t("poster.search.results")}
      </h2>
      <ul className="flex flex-col gap-2">
        {shown.map((item) => {
          const district = item.level === "district" ? item.code : item.code.slice(0, 8);
          const village = item.level === "village" ? `&village=${item.code}` : "";
          return (
            <li key={item.code}>
              <Link
                to={`/poster?district=${district}${village}`}
                className="flex min-h-target items-center justify-between gap-3 rounded-control border border-line bg-surface px-4 py-2 text-ink no-underline hover:border-control"
              >
                {item.level === "district"
                  ? t("poster.search.district", { name: item.name, regency: item.regencyName })
                  : t("poster.search.village", {
                      name: item.name,
                      district: item.districtName as string,
                      regency: item.regencyName,
                    })}
                <Icon name="chevronRight" className="size-5 shrink-0 text-muted" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Staff print a QR poster per village (K92, LA-84). Only the posters are printed.
export function PosterScreen({ load, origin }: { readonly load: PosterLoad; readonly origin: string }) {
  const t = useText();
  const hydrated = useHydrated();
  return (
    <div className="min-h-dvh print:bg-white">
      <main className="mx-auto flex w-full max-w-[72rem] flex-col gap-6 px-4 py-8 md:px-6 print:p-0">
        <header className="flex flex-col gap-3 print:hidden">
          <Link to="/desk" className={buttonStyles({ variant: "link", size: "min", className: "self-start px-0" })}>
            <Icon name="arrowLeft" className="size-5" />
            {t("poster.back")}
          </Link>
          <h1 className="text-page font-bold tracking-[-0.01em]">{t("poster.title")}</h1>
          <p className="max-w-[65ch] text-muted">{t("poster.lead")}</p>
          <Form method="get" action="/poster" className="flex max-w-xl flex-wrap items-end gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="font-semibold">{t("poster.search.label")}</span>
              <input
                name="q"
                defaultValue={load.query}
                minLength={3}
                maxLength={60}
                className="min-h-target rounded-control border border-control bg-surface px-3 text-ink"
              />
            </label>
            <Button variant="primary">{t("poster.search.submit")}</Button>
          </Form>
        </header>
        <div className="flex flex-col gap-4 print:hidden">
          {load.kind === "short" ? <Notice kind="info">{t("poster.search.short")}</Notice> : null}
          {load.kind === "unavailable" ? <Notice kind="error">{t("poster.unavailable")}</Notice> : null}
          {load.kind === "results" ? <Results items={load.items} query={load.query} /> : null}
          {load.kind === "sheets" && load.cut ? <Notice kind="info">{t("poster.cut")}</Notice> : null}
          {load.kind === "sheets" ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-semibold">
                {load.one
                  ? t("poster.village", { name: (load.villages[0] as Item).name })
                  : t("poster.area", {
                      count: load.villages.length,
                      name: load.area.name,
                      regency: load.area.regencyName,
                    })}
              </p>
              <div className="flex flex-wrap gap-3">
                {load.one ? (
                  <Link to={`/poster?district=${load.district}`} className={buttonStyles({ variant: "secondary" })}>
                    {t("poster.allVillages")}
                  </Link>
                ) : null}
                {hydrated ? (
                  <Button variant="primary" onClick={() => window.print()}>
                    <Icon name="fileText" className="size-5" />
                    {t("poster.print")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        {load.kind === "sheets" ? (
          <div className="flex flex-col gap-6 print:gap-0">
            {load.villages.map((village) => (
              <Sheet key={village.code} village={village} origin={origin} />
            ))}
          </div>
        ) : null}
      </main>
    </div>
  );
}
