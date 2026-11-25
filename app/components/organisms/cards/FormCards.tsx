import { useState } from "react";
import type { Card } from "../../../../src/contract/card";
import { unitKeyOf } from "../../../../src/copy/units";
import { problemOf } from "../../../lib/envelope";
import { useBusy } from "../../../lib/hooks";
import { useText } from "../../../lib/text";
import { postedValue } from "../../../lib/turnForm";
import { Button } from "../../atoms/Button";
import { Input, Textarea } from "../../atoms/controls";
import { Field } from "../../molecules/Field";
import { ActionRow } from "../../molecules/layout";
import { Notice } from "../../molecules/Notice";
import { CardShell, TurnForm, useDraftView, useFocusField, usePostedValue } from "./CardShell";

type BoxCard = Extract<Card, { kind: "neighbourhood" | "numberForm" | "textQuestion" }>;
type Box = BoxCard["fields"][number];

// A button that answers the whole card at once ("Tidak ada semua", "Tidak tahu").
export function OptionAction({
  id,
  labelKey,
  variant = "secondary",
}: {
  readonly id: string;
  readonly labelKey: string;
  readonly variant?: "primary" | "secondary";
}) {
  const t = useText();
  const busy = useBusy(id, "optionIds");
  return (
    <Button name="optionIds" value={id} variant={variant} busyLabel={busy ? t("common.saving") : null}>
      {t(labelKey)}
    </Button>
  );
}

export function SaveAction({ labelKey = "common.save" }: { readonly labelKey?: string }) {
  const t = useText();
  const busy = useBusy("save");
  return (
    <Button name="intent" value="save" variant="primary" busyLabel={busy ? t("common.saving") : null}>
      {t(labelKey)}
    </Button>
  );
}

// "12 dari 300 huruf": live with script, the count of what the page was drawn with otherwise.
export function useCharCount(initial: string) {
  const [length, setLength] = useState(initial.length);
  return {
    length,
    onInput: (event: { currentTarget: { value: string } }) => setLength(event.currentTarget.value.length),
  };
}

function NumberBox({ box, focus }: { readonly box: Box; readonly focus: boolean }) {
  const t = useText();
  const { envelope } = useDraftView();
  const value = usePostedValue(box.id, box.value);
  const unit = unitKeyOf(box.id);
  return (
    <Field
      id={box.id}
      label={t(box.labelKey)}
      unit={unit ? t(unit) : null}
      definition={box.definitionKey ? t(box.definitionKey) : null}
      problem={problemOf(envelope, box.id)}
      focus={focus}
      className="number-row"
    >
      {(control) => (
        <Input
          {...control}
          inputMode="numeric"
          autoComplete="off"
          defaultValue={value}
          className="w-[max(8ch,6rem)] text-end text-card font-semibold tabular-nums"
        />
      )}
    </Field>
  );
}

export function NumberFormCard({ card }: { readonly card: Extract<Card, { kind: "numberForm" }> }) {
  const t = useText();
  const focus = useFocusField(card.fields.map((box) => box.id));
  const again = card.fields.some((box) => box.askedBefore);
  return (
    <CardShell
      card={card}
      title={t(card.titleKey, card.params)}
      prompt={card.promptKey ? t(card.promptKey, card.params) : null}
      focusId={focus}
    >
      {again ? <Notice kind="info">{t("card.numberForm.stillEmpty")}</Notice> : null}
      <p className="text-meta text-muted">{t("card.numberForm.prompt")}</p>
      <TurnForm>
        <div className="flex flex-col divide-y divide-line">
          {card.fields.map((box) => (
            <NumberBox key={box.id} box={box} focus={focus === box.id} />
          ))}
        </div>
        <ActionRow>
          {card.formActions.includes("allNone") ? <OptionAction id="allNone" labelKey="common.allNone" /> : null}
          {card.formActions.includes("allUnknown") ? <OptionAction id="allUnknown" labelKey="common.unknown" /> : null}
          <SaveAction />
        </ActionRow>
      </TurnForm>
    </CardShell>
  );
}

export function NeighbourhoodCard({ card }: { readonly card: Extract<Card, { kind: "neighbourhood" }> }) {
  const t = useText();
  const { envelope, posted } = useDraftView();
  const focus = useFocusField(card.fields.map((box) => box.id));
  return (
    <CardShell
      card={card}
      title={t(card.titleKey, card.params)}
      prompt={card.promptKey ? t(card.promptKey, card.params) : null}
      focusId={focus}
    >
      <TurnForm>
        <div className="flex flex-wrap gap-4">
          {card.fields.map((box) => (
            <Field
              key={box.id}
              id={box.id}
              label={t(box.labelKey)}
              problem={problemOf(envelope, box.id)}
              focus={focus === box.id}
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  autoComplete="off"
                  defaultValue={postedValue(posted, box.id, box.value)}
                  className="w-[max(5ch,4.5rem)] tabular-nums"
                />
              )}
            </Field>
          ))}
        </div>
        <ActionRow>
          <OptionAction id="unknown" labelKey="common.unknown" />
          <SaveAction />
        </ActionRow>
      </TurnForm>
    </CardShell>
  );
}

export function TextQuestionCard({ card }: { readonly card: Extract<Card, { kind: "textQuestion" }> }) {
  const t = useText();
  const { envelope } = useDraftView();
  const box = card.fields[0] as Box;
  const focus = useFocusField([box.id]);
  const value = usePostedValue(box.id, box.value);
  const count = useCharCount(value);
  const max = box.maxLength ?? 0;
  return (
    <CardShell
      card={card}
      title={t(card.titleKey, card.params)}
      prompt={card.promptKey ? t(card.promptKey, card.params) : null}
      focusId={focus}
    >
      {box.askedBefore ? <Notice kind="info">{t("card.numberForm.stillEmpty")}</Notice> : null}
      <TurnForm>
        <Field
          id={box.id}
          label={t(box.labelKey)}
          hint={t("card.textQuestion.hint", { max })}
          problem={problemOf(envelope, box.id)}
          focus={focus === box.id}
        >
          {(control) => <Textarea {...control} defaultValue={value} onInput={count.onInput} />}
        </Field>
        <p className="text-meta text-muted tabular-nums">{t("common.charCount", { length: count.length, max })}</p>
        <ActionRow>
          <OptionAction id="unknown" labelKey="common.unknown" />
          <SaveAction />
        </ActionRow>
      </TurnForm>
    </CardShell>
  );
}
