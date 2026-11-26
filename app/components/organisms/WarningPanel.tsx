import { type FormEvent, useEffect, useState } from "react";
import type { PlaceResults } from "../../../src/contract/card";
import { ALL_HAZARDS, MAX_DISTRICTS, WARNING_HAZARDS } from "../../../src/domain/warnings";
import { getJson, postJson, postOnly, putJson } from "../../lib/clientApi";
import { type PushBrowser, type PushPhone, pushBrowser } from "../../lib/push";
import { useText } from "../../lib/text";
import { Button } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { Notice } from "../molecules/Notice";

type District = { readonly code: string; readonly name: string; readonly regencyName?: string };
type View = { readonly districts: District[]; readonly hazards: number | null; readonly threshold: number | null };

type Panel =
  | { readonly kind: "checking" | "unsupported" | "shut" | "denied" }
  | { readonly kind: "on"; readonly view: View }
  // Picking: a phone warned of nothing, or one changing what it has.
  | { readonly kind: "picking"; readonly before: View | null };

type Said = "stopped" | "failed" | "needDistrict" | "needHazard" | "denied" | null;

type Found = District & { readonly regencyName: string };

const districtsOf = (items: PlaceResults["items"]): Found[] => [
  ...new Map(
    items
      .filter((item) => item.level !== "regency")
      .map((item) => {
        const code = item.level === "district" ? item.code : item.code.slice(0, 8);
        const name = item.level === "district" ? item.name : (item.districtName as string);
        return [code, { code, name, regencyName: item.regencyName }] as const;
      }),
  ).values(),
];

function DistrictSearch({ onPick, full }: { readonly onPick: (district: District) => void; readonly full: boolean }) {
  const t = useText();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const search = async () => {
    if (query.trim().length < 3) return;
    const answer = await getJson<PlaceResults>(`/places/search?q=${encodeURIComponent(query.trim())}`);
    setFound(answer.kind === "ok" ? districtsOf(answer.body.items) : []);
  };
  if (full) return <p className="text-meta text-muted">{t("info.warn.full")}</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="font-semibold">{t("info.warn.search.label")}</span>
          <input
            type="search"
            value={query}
            minLength={3}
            maxLength={60}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
            className="min-h-target rounded-control border border-control bg-surface px-3 text-ink"
          />
        </label>
        <Button type="button" variant="secondary" onClick={() => void search()}>
          {t("info.warn.search.submit")}
        </Button>
      </div>
      {found?.length === 0 ? <p className="text-meta text-muted">{t("info.warn.search.none")}</p> : null}
      {found && found.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {found.map((district) => (
            <li
              key={district.code}
              className="flex items-center justify-between gap-3 rounded-control border border-line px-3 py-1.5"
            >
              {t("info.warn.district", { name: district.name, regency: district.regencyName })}
              <Button type="button" variant="secondary" size="min" onClick={() => onPick(district)}>
                <Icon name="plus" className="size-4" />
                {t("info.warn.add")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Picker({
  before,
  onSave,
  onCancel,
  said,
  busy,
}: {
  readonly busy: boolean;
  readonly before: View | null;
  readonly onSave: (districts: District[], hazards: number, threshold: number) => void;
  readonly onCancel: (() => void) | null;
  readonly said: Said;
}) {
  const t = useText();
  const [districts, setDistricts] = useState<District[]>(before?.districts ?? []);
  const [hazards, setHazards] = useState(before?.hazards ?? ALL_HAZARDS);
  const [threshold, setThreshold] = useState(before?.threshold ?? 1);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(districts, hazards, threshold);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">{t("info.warn.picked", { count: districts.length })}</legend>
        {districts.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {districts.map((district) => (
              <li key={district.code}>
                <Button
                  type="button"
                  variant="secondary"
                  size="min"
                  aria-label={t("info.warn.remove", { name: district.name })}
                  onClick={() => setDistricts(districts.filter((one) => one.code !== district.code))}
                >
                  {district.name}
                  <Icon name="circleX" className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <DistrictSearch
          full={districts.length >= MAX_DISTRICTS}
          onPick={(district) =>
            setDistricts(districts.some((one) => one.code === district.code) ? districts : [...districts, district])
          }
        />
        {said === "needDistrict" ? <p className="text-meta text-danger">{t("info.warn.needDistrict")}</p> : null}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">{t("info.warn.hazards")}</legend>
        {WARNING_HAZARDS.map(([code, bit]) => (
          <label key={code} className="flex min-h-target-min items-center gap-3">
            <input
              type="checkbox"
              className="size-5"
              checked={(hazards & bit) !== 0}
              onChange={() => setHazards(hazards ^ bit)}
            />
            {t(`info.warn.hazard.${code}`)}
          </label>
        ))}
        {said === "needHazard" ? <p className="text-meta text-danger">{t("info.warn.needHazard")}</p> : null}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">{t("info.warn.threshold")}</legend>
        {[1, 2, 3].map((level) => (
          <label key={level} className="flex min-h-target-min items-center gap-3">
            <input
              type="radio"
              name="threshold"
              className="size-5"
              checked={threshold === level}
              onChange={() => setThreshold(level)}
            />
            {t(`info.warn.threshold.${level}`)}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" disabled={busy}>
          <Icon name="bell" className="size-5" />
          {before ? t("info.warn.update") : t("info.warn.save")}
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t("info.warn.cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

// A phone warned of up to three districts' outlook (M07 TASK-002). Needs the page's service worker,
// so it shows only once the page runs in the browser.
export function WarningPanel({ push = pushBrowser }: { readonly push?: PushBrowser }) {
  const t = useText();
  const [panel, setPanel] = useState<Panel>({ kind: "checking" });
  const [said, setSaid] = useState<Said>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const settle = (next: Panel) => live && setPanel(next);
    void (async () => {
      if (!(await push.supported())) return settle({ kind: "unsupported" });
      const key = await getJson<{ publicKey: string | null }>("/warnings/key");
      if (key.kind !== "ok" || key.body.publicKey === null) return settle({ kind: "shut" });
      if (push.denied()) return settle({ kind: "denied" });
      const current = await push.current();
      if (current === null) return settle({ kind: "picking", before: null });
      const view = await postJson<View>("/warnings/status", { endpoint: current.phone.endpoint });
      settle(
        view.kind === "ok" && view.body.districts.length > 0
          ? { kind: "on", view: view.body }
          : { kind: "picking", before: null },
      );
    })();
    return () => {
      live = false;
    };
  }, [push]);

  const save = async (districts: District[], hazards: number, threshold: number) => {
    if (districts.length === 0) return setSaid("needDistrict");
    if (hazards === 0) return setSaid("needHazard");
    setBusy(true);
    setSaid(null);
    const key = await getJson<{ publicKey: string | null }>("/warnings/key");
    const subscribed =
      key.kind === "ok" && key.body.publicKey !== null
        ? ((await push.current()) ?? (await push.subscribe(key.body.publicKey)))
        : null;
    if (subscribed === null) {
      setBusy(false);
      return setSaid(push.denied() ? "denied" : "failed");
    }
    const phone: PushPhone = subscribed.phone;
    const kept = await putJson<View>("/warnings", {
      ...phone,
      districts: districts.map((district) => district.code),
      hazards,
      threshold,
    });
    setBusy(false);
    if (kept.kind === "ok") setPanel({ kind: "on", view: kept.body });
    else setSaid("failed");
  };

  // A phone that lost its subscription some other way is warned of nothing already.
  const stop = async () => {
    setBusy(true);
    const current = await push.current();
    if (current !== null) {
      const stopped = await postOnly("/warnings/stop", { endpoint: current.phone.endpoint });
      if (stopped.kind !== "ok") {
        setBusy(false);
        return setSaid("failed");
      }
      await current.stop();
    }
    setBusy(false);
    setSaid("stopped");
    setPanel({ kind: "picking", before: null });
  };

  return (
    <section aria-labelledby="info-warn" aria-busy={busy} className="flex flex-col gap-4 card-surface p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="info-warn" className="text-card font-bold">
          {t("info.warn.title")}
        </h2>
        <p className="max-w-[65ch] text-muted">{t("info.warn.lead")}</p>
      </div>
      {panel.kind === "checking" ? <p className="text-meta text-muted">{t("info.warn.checking")}</p> : null}
      {panel.kind === "unsupported" ? <Notice kind="info">{t("info.warn.unsupported")}</Notice> : null}
      {panel.kind === "shut" ? <Notice kind="info">{t("info.warn.shut")}</Notice> : null}
      {panel.kind === "denied" || said === "denied" ? <Notice kind="error">{t("info.warn.denied")}</Notice> : null}
      {said === "failed" ? <Notice kind="error">{t("info.warn.failed")}</Notice> : null}
      {said === "stopped" ? <Notice kind="info">{t("info.warn.stopped")}</Notice> : null}
      {panel.kind === "on" ? (
        <div className="flex flex-col gap-3">
          <p>
            {t("info.warn.on", {
              districts: panel.view.districts.map((district) => district.name).join(", "),
              level: t(`info.warn.threshold.${panel.view.threshold}`),
            })}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setPanel({ kind: "picking", before: panel.view })}>
              {t("info.warn.change")}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void stop()}>
              <Icon name="bellOff" className="size-5" />
              {t("info.warn.stop")}
            </Button>
          </div>
        </div>
      ) : null}
      {panel.kind === "picking" ? (
        <Picker
          before={panel.before}
          said={said}
          busy={busy}
          onSave={(districts, hazards, threshold) => void save(districts, hazards, threshold)}
          onCancel={panel.before ? () => setPanel({ kind: "on", view: panel.before as View }) : null}
        />
      ) : null}
    </section>
  );
}
