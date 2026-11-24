import { Form, Link, useNavigation } from "react-router";
import type { Card } from "../../../../src/contract/card";
import { problemOf } from "../../../lib/envelope";
import { useBusy } from "../../../lib/hooks";
import { areaName, type PlaceItem, rowText, searchStatus } from "../../../lib/place";
import { breakAfterSlash } from "../../../lib/slash";
import { useText } from "../../../lib/text";
import { localDateText } from "../../../lib/time";
import { Button, buttonStyles } from "../../atoms/Button";
import { Input } from "../../atoms/controls";
import { Icon } from "../../atoms/Icon";
import { Field } from "../../molecules/Field";
import { LifeLine } from "../../molecules/Notice";
import { CardShell, TurnForm, useDraftView } from "./CardShell";

type SearchCard = Extract<Card, { kind: "placeSearch" | "regencyVillages" }>;

const row =
  "flex min-h-target-main w-full min-w-0 items-center gap-3 rounded-control border border-control bg-surface px-4 py-2 text-start text-ink hover:bg-[color-mix(in_oklch,var(--surface),var(--ink)_4%)]";

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
  const searched = card.query !== null || unavailable || problem !== null;
  const area = card.kind === "regencyVillages";
  return (
    <CardShell
      card={card}
      title={area ? t("card.regencyVillages.title", { areaName: areaName(card, t) }) : t(card.titleKey, card.params)}
      prompt={area ? null : card.promptKey && t(card.promptKey, card.params)}
      focusId={searched ? "q" : null}
    >
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
            <Input
              {...control}
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              defaultValue={card.query ?? ""}
              placeholder={area ? undefined : t("card.placeSearch.placeholder")}
            />
          )}
        </Field>
        <Button variant="primary" className="@actions:self-start">
          {t(area ? "card.regencyVillages.submit" : "card.placeSearch.submit")}
        </Button>
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
