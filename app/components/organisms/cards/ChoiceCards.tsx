import type { ChangeEvent } from "react";
import type { Card } from "../../../../src/contract/card";
import { errorIdOf, problemOf } from "../../../lib/envelope";
import { settleExclusive } from "../../../lib/exclusive";
import { useBusy } from "../../../lib/hooks";
import { type Text, useText } from "../../../lib/text";
import { Input } from "../../atoms/controls";
import type { IconName } from "../../atoms/icons";
import { TileButton, TileCheck, TileGrid } from "../../molecules/ChoiceTile";
import { Field, FieldError } from "../../molecules/Field";
import { Notice } from "../../molecules/Notice";
import { CardShell, TurnForm, useDraftView, useFocusField, usePostedOptions, usePostedValue } from "./CardShell";
import { SaveAction } from "./FormCards";

type ChoiceLike = Extract<Card, { kind: "choice" | "multiChoice" | "chronologyStep" }>;
type Option = ChoiceLike["options"][number];

const HAZARD_ICONS: Readonly<Record<string, IconName>> = {
  flood: "droplets",
  landslide: "mountain",
  tidalWaveAbrasion: "shell",
  extremeWeather: "tornado",
  drought: "sun",
  forestFire: "trees",
  earthquake: "activity",
  tsunami: "waves",
  volcanicEruption: "mountainSnow",
  buildingFire: "flame",
};

// Types guessed from the reporter's words come first, in the order they were given.
const guessesFirst = (options: readonly Option[]) => [
  ...options.filter((option) => option.guess === true),
  ...options.filter((option) => option.guess !== true),
];

const noteOf = (option: Option, t: Text) =>
  option.noteKey !== null && t.has(option.noteKey) ? t(option.noteKey) : null;

function OptionButton({
  option,
  icon,
  focus,
}: {
  readonly option: Option;
  readonly icon: IconName | null;
  readonly focus: boolean;
}) {
  const t = useText();
  const busy = useBusy(option.id, "optionIds");
  return (
    <TileButton
      id={`option-${option.id}`}
      value={option.id}
      label={t(option.labelKey)}
      note={noteOf(option, t)}
      extra={option.guess ? t("card.choice.hazardType.guess") : null}
      icon={icon}
      busyLabel={busy ? t("common.saving") : null}
      autoFocus={focus}
    />
  );
}

function OtherText({ option, focus }: { readonly option: Option; readonly focus: boolean }) {
  const t = useText();
  const { envelope } = useDraftView();
  const value = usePostedValue("other", null);
  return (
    <Field
      id="other"
      label={t(option.labelKey)}
      hint={t("chronology.otherHint", { max: Number(option.freeTextMaxLength) })}
      problem={problemOf(envelope, "other")}
      focus={focus}
      className="reveal-other-text min-w-0 flex-col gap-1.5"
    >
      {(control) => <Input {...control} defaultValue={value} />}
    </Field>
  );
}

// Tiles that need a second step (several picks, or a typed "Lainnya") are native boxes with a save.
function CheckedTiles({
  card,
  multiple,
  legend,
}: {
  readonly card: ChoiceLike;
  readonly multiple: boolean;
  readonly legend: string;
}) {
  const t = useText();
  const { envelope } = useDraftView();
  const posted = usePostedOptions();
  const focus = useFocusField(["options", "other"]);
  const refused = problemOf(envelope, "options") ? errorIdOf("options") : undefined;
  const exclusive = new Set(card.options.filter((option) => option.exclusive).map((option) => option.id));
  const other = card.options.find((option) => option.freeTextMaxLength !== null) ?? null;
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const form = event.currentTarget.form as HTMLFormElement;
    const boxes = [...form.querySelectorAll<HTMLInputElement>('input[name="optionIds"]')];
    settleExclusive(boxes, event.currentTarget, exclusive);
  };
  return (
    <TurnForm>
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="sr-only">{legend}</legend>
        {multiple ? <p className="text-meta text-muted">{t("card.multiChoice.hint")}</p> : null}
        <TileGrid>
          {card.options.map((option, index) => (
            <TileCheck
              key={option.id}
              id={`option-${option.id}`}
              type={multiple ? "checkbox" : "radio"}
              name="optionIds"
              value={option.id}
              checked={posted?.includes(option.id) ?? false}
              autoFocus={focus === "options" && index === 0}
              describedBy={refused}
              label={t(option.labelKey)}
              note={noteOf(option, t)}
              onChange={multiple ? change : undefined}
            />
          ))}
        </TileGrid>
        <FieldError id="options" problem={problemOf(envelope, "options")} />
      </fieldset>
      {other ? <OtherText option={other} focus={focus === "other"} /> : null}
      <SaveAction />
    </TurnForm>
  );
}

// Choice, multiple choice and one step of the guided chronology.
export function ChoiceCard({ card }: { readonly card: ChoiceLike }) {
  const t = useText();
  const { envelope } = useDraftView();
  const focus = useFocusField(["options", "other"]);
  const multiple = card.kind === "multiChoice" || (card.kind === "chronologyStep" && card.multiple);
  const stepped = card.kind === "chronologyStep";
  const twoSteps = multiple || card.options.some((option) => option.freeTextMaxLength !== null);
  const hazardCard = card.kind === "choice" && card.fieldId === "hazardType";
  const title = t(stepped ? (card.promptKey ?? card.titleKey) : card.titleKey, card.params);
  return (
    <CardShell
      card={card}
      title={title}
      prompt={stepped || card.promptKey === null ? null : t(card.promptKey, card.params)}
      progress={stepped ? t("card.chronologyStep.progress", card.params) : null}
      focusId={focus === "options" ? `option-${guessesFirst(card.options)[0]?.id}` : focus}
    >
      {card.options.length === 0 ? (
        <Notice kind="error">{t("error.card.noOptions")}</Notice>
      ) : twoSteps ? (
        <CheckedTiles card={card} multiple={multiple} legend={title} />
      ) : (
        <TurnForm>
          <TileGrid>
            {guessesFirst(card.options).map((option, index) => (
              <OptionButton
                key={option.id}
                option={option}
                icon={hazardCard ? (HAZARD_ICONS[option.id] ?? null) : null}
                focus={focus === "options" && index === 0}
              />
            ))}
          </TileGrid>
          <FieldError id="options" problem={problemOf(envelope, "options")} />
        </TurnForm>
      )}
    </CardShell>
  );
}
