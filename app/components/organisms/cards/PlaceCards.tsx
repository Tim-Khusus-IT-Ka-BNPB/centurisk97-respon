import { type ReactNode, useState } from "react";
import { Form, Link, useNavigation, useSubmit } from "react-router";
import type { Card } from "../../../../src/contract/card";
import { localDateText } from "../../../../src/copy/time";
import { precisionText } from "../../../../src/copy/values";
import { readPosition } from "../../../lib/device";
import { problemOf } from "../../../lib/envelope";
import { useBusy, useHydrated } from "../../../lib/hooks";
import { areaName, type PlaceItem, rowText, searchStatus } from "../../../lib/place";
import { breakAfterSlash } from "../../../lib/slash";
import { useText } from "../../../lib/text";
import { Button, buttonStyles } from "../../atoms/Button";
import { Input } from "../../atoms/controls";
import { Icon } from "../../atoms/Icon";
import { Field } from "../../molecules/Field";
import { LifeLine, Notice } from "../../molecules/Notice";
import { CardShell, TurnForm, useDraftView } from "./CardShell";

const row =
  "flex min-h-target-main w-full min-w-0 items-center gap-3 rounded-control border border-control bg-surface px-4 py-2 text-start text-ink hover:border-primary hover:bg-[color-mix(in_oklab,var(--surface),var(--selected)_55%)]";

type SearchCard = Extract<Card, { kind: "placeSearch" | "regencyVillages" }>;
type ConfirmCard = Extract<Card, { kind: "placeConfirm" }>;

type Locating =
  | { readonly kind: "idle" | "reading" }
  | { readonly kind: "failed"; readonly reason: "denied" | "unavailable" | "timeout" | "unsupported" };

// Reads the phone's position and sends it as a turn. It needs script, so a page without script
// never shows it: search below stays the way to give the place.
function LocateButton({ label, hint }: { readonly label: string; readonly hint: string }) {
  const t = useText();
  const hydrated = useHydrated();
  const submit = useSubmit();
  const { draft, turnKey } = useDraftView();
  const sending = useBusy("locate", "kind");
  const [locating, setLocating] = useState<Locating>({ kind: "idle" });
  if (!hydrated) return null;
  const read = async () => {
    setLocating({ kind: "reading" });
    const result = await readPosition();
    if (result.kind !== "read") {
      setLocating({ kind: "failed", reason: result.kind });
      return;
    }
    setLocating({ kind: "idle" });
    const form = new FormData();
    for (const [name, value] of Object.entries({
      action: "turn",
      kind: "locate",
      cardId: draft.card.cardId,
      revision: String(draft.revision),
      turnKey,
      lat: String(result.position.lat),
      lon: String(result.position.lon),
      accuracy: String(result.position.accuracy),
    }))
      form.set(name, value);
    submit(form, { method: "post", replace: true, preventScrollReset: true });
  };
  const busy = locating.kind === "reading" || sending;
  return (
    <div className="flex flex-col gap-2">
      {locating.kind === "failed" ? <Notice kind="error">{t(`card.placeSearch.${locating.reason}`)}</Notice> : null}
      <Button
        type="button"
        variant="primary"
        size="main"
        className="@actions:self-start"
        onClick={read}
        busyLabel={busy ? t("card.placeSearch.locating") : null}
      >
        <Icon name="locateFixed" />
        {locating.kind === "failed" && locating.reason === "denied" ? t("card.placeSearch.retry") : label}
      </Button>
      <p className="text-meta text-muted">{hint}</p>
    </div>
  );
}

const coordinate = (value: number) => value.toFixed(6);
const kilometres = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

// "Lokasi terbaca": the village the reading fell in, its coordinates and accuracy, to confirm or
// replace with one of the nearest villages.
export function PlaceConfirmCard({ card }: { readonly card: ConfirmCard }) {
  const t = useText();
  const { village, point } = card;
  return (
    <CardShell
      card={card}
      title={t(card.titleKey, card.params)}
      prompt={card.promptKey && t(card.promptKey)}
      focusId={null}
    >
      {card.nearby === null ? (
        <>
          <div className="flex flex-col gap-1 rounded-control border border-line bg-sunken p-3">
            <p className="flex items-start gap-2 font-semibold break-words">
              <Icon name="mapPin" className="mt-0.5" />
              {breakAfterSlash(t("card.placeSearch.rowVillage", { village: village.villageName }))}
            </p>
            <p className="break-words">
              {breakAfterSlash(
                t("card.placeSearch.rowPlace", {
                  district: village.districtName,
                  regency: village.regencyName,
                  province: village.provinceName,
                }),
              )}
            </p>
            <p className="text-meta tabular-nums">
              {t("card.placeConfirm.coordinates", { lat: coordinate(point.lat), lon: coordinate(point.lon) })}
            </p>
            <p className="text-meta">{precisionText(t, card.precision, point.accuracyM)}</p>
          </div>
          <TurnForm className="flex flex-col gap-2 @actions:flex-row">
            {card.options.map((option) => (
              <OptionButton
                key={option.id}
                id={option.id}
                label={t(option.labelKey)}
                primary={option.id === "confirm"}
              />
            ))}
          </TurnForm>
        </>
      ) : (
        <>
          <TurnForm>
            <ul className="flex flex-col gap-2">
              {card.nearby.map((one) => (
                <li key={one.code} className="min-w-0">
                  <NearbyRow code={one.code}>
                    <span className="flex min-w-0 flex-1 flex-col break-words">
                      <span className="font-semibold">
                        {breakAfterSlash(t("card.placeSearch.rowVillage", { village: one.villageName }))}
                      </span>
                      <span className="text-meta text-muted tabular-nums">
                        {t("card.placeConfirm.nearbyRow", {
                          district: one.districtName,
                          km: kilometres.format(one.km),
                        })}
                      </span>
                    </span>
                  </NearbyRow>
                </li>
              ))}
            </ul>
          </TurnForm>
          <LocateButton label={t("card.placeConfirm.relocate")} hint={t("card.placeConfirm.relocateHint")} />
        </>
      )}
    </CardShell>
  );
}

function OptionButton({
  id,
  label,
  primary,
}: {
  readonly id: string;
  readonly label: string;
  readonly primary: boolean;
}) {
  const t = useText();
  const busy = useBusy(id, "optionIds");
  return (
    <Button
      name="optionIds"
      value={id}
      variant={primary ? "primary" : "secondary"}
      size="main"
      busyLabel={busy ? t("common.saving") : null}
    >
      {label}
    </Button>
  );
}

function NearbyRow({ code, children }: { readonly code: string; readonly children: ReactNode }) {
  const t = useText();
  const busy = useBusy(code, "villageCode");
  return (
    <button
      type="submit"
      name="villageCode"
      value={code}
      aria-disabled={busy ? true : undefined}
      onClick={(event) => busy && event.preventDefault()}
      className={row}
    >
      {busy ? <span className="flex-1">{t("common.saving")}</span> : children}
      <Icon name="chevronRight" className="text-muted" />
    </button>
  );
}

function RowWords({ item }: { readonly item: PlaceItem }) {
  const t = useText();
  const { lead, place } = rowText(item, t);
  return (
    <span className="flex min-w-0 flex-1 flex-col break-words">
      {lead ? <span className="font-semibold">{breakAfterSlash(lead)}</span> : null}
      <span className={lead ? "text-meta text-muted" : "font-semibold"}>{breakAfterSlash(place)}</span>
    </span>
  );
}

function VillageRow({ item }: { readonly item: PlaceItem }) {
  const t = useText();
  const busy = useBusy(item.code, "villageCode");
  return (
    <button
      type="submit"
      name="villageCode"
      value={item.code}
      aria-disabled={busy ? true : undefined}
      onClick={(event) => busy && event.preventDefault()}
      className={row}
    >
      {busy ? <span className="flex-1">{t("common.saving")}</span> : <RowWords item={item} />}
      <Icon name="chevronRight" className="text-muted" />
    </button>
  );
}

function Results({ card }: { readonly card: SearchCard }) {
  const t = useText();
  const navigation = useNavigation();
  const loadingKey = card.kind === "placeSearch" ? "card.placeSearch.loading" : "card.regencyVillages.loading";
  if (navigation.state === "loading" && navigation.formMethod === "GET")
    return (
      <div className="flex flex-col gap-2">
        <p className="text-meta text-muted">{t(loadingKey)}</p>
        {[0, 1, 2].map((slot) => (
          <div key={slot} className="min-h-target-main rounded-control border border-line bg-sunken" />
        ))}
      </div>
    );
  if (card.places === null) return null;
  const villages = card.places.items.filter((item) => item.level === "village");
  const areas = card.places.items.filter((item) => item.level !== "village");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-meta tabular-nums">{searchStatus(card, t)}</p>
      {card.places.similar ? <p className="text-meta text-muted">{t("card.placeSearch.similar")}</p> : null}
      {areas.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {areas.map((item) => (
            <li key={item.code}>
              <Link to={`?area=${encodeURIComponent(item.code)}`} replace className={row}>
                <RowWords item={item} />
                <Icon name="chevronRight" className="text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {villages.length > 0 ? (
        <TurnForm>
          <ul className={card.kind === "regencyVillages" ? "grid gap-2 @tiles:grid-cols-2" : "flex flex-col gap-2"}>
            {villages.map((item) => (
              <li key={item.code} className="min-w-0">
                <VillageRow item={item} />
              </li>
            ))}
          </ul>
        </TurnForm>
      ) : null}
      <p className="text-meta text-muted">
        {t("card.placeSearch.dataDate", { dataDate: localDateText(card.places.dataDate) })}
      </p>
    </div>
  );
}

// Place search and the villages of one area. Both are GET forms, so searching works with no script.
export function PlaceCard({ card }: { readonly card: SearchCard }) {
  const t = useText();
  const { envelope } = useDraftView();
  const problem = problemOf(envelope, "q");
  const unavailable = envelope?.error.code === "place.unavailable";
  // A place the reporter named is searched for them: the card arrives as any other, keyboard closed.
  const typed = card.query !== null && !(card.kind === "placeSearch" && card.named === true);
  const searched = typed || unavailable || problem !== null;
  const area = card.kind === "regencyVillages";
  return (
    <CardShell
      card={card}
      title={area ? t("card.regencyVillages.title", { areaName: areaName(card, t) }) : t(card.titleKey, card.params)}
      prompt={area ? null : card.promptKey && t(card.promptKey, card.params)}
      focusId={searched ? "q" : null}
    >
      {area ? null : <LocateButton label={t("card.placeSearch.locate")} hint={t("card.placeSearch.locateHint")} />}
      <Form method="get" replace preventScrollReset className="flex min-w-0 flex-col gap-3">
        {area ? <input type="hidden" name="area" value={card.areaCode} /> : null}
        <Field
          id="q"
          label={t(area ? "card.regencyVillages.prompt" : "card.placeSearch.input")}
          hint={area ? null : t("card.placeSearch.hintMin")}
          problem={problem}
          focus={searched}
        >
          {(control) => (
            <div className="flex flex-wrap gap-2">
              <Input
                {...control}
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                defaultValue={card.query ?? ""}
                placeholder={area ? undefined : t("card.placeSearch.placeholder")}
                className="min-w-[min(100%,9rem)] flex-1"
              />
              <Button variant={area ? "primary" : "secondary"}>
                {t(area ? "card.regencyVillages.submit" : "card.placeSearch.submit")}
              </Button>
            </div>
          )}
        </Field>
      </Form>
      {unavailable ? <LifeLine /> : <Results card={card} />}
      {area ? (
        <Link to="?" replace className={buttonStyles({ variant: "quiet" })}>
          {t("card.regencyVillages.back")}
        </Link>
      ) : null}
    </CardShell>
  );
}
