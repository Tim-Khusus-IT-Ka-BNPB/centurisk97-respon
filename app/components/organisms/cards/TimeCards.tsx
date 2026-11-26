import type { Card } from "../../../../src/contract/card";
import { errorIdOf, problemOf } from "../../../lib/envelope";
import { useText } from "../../../lib/text";
import { Input, Textarea } from "../../atoms/controls";
import { TileCheck } from "../../molecules/ChoiceTile";
import { Field, FieldError } from "../../molecules/Field";
import { ActionRow } from "../../molecules/layout";
import { CardShell, TurnForm, useDraftView, useFocusField, usePostedOptions, usePostedValue } from "./CardShell";
import { OptionAction, SaveAction, useCharCount } from "./FormCards";

type TimeCard = Extract<Card, { kind: "timeCard" }>;
const DAYS = ["today", "yesterday", "otherDate", "olderThan30Days"] as const;

// Where a refused date sends focus: the date box when "Tanggal lain" is picked, else the picked day.
export function dateFocusTarget(picked: readonly string[] | null): string {
  if (picked?.includes("otherDate")) return "date";
  const day = DAYS.find((id) => picked?.includes(id));
  return day ? `day-${day}` : "day-today";
}

export function TimeCardView({ card }: { readonly card: TimeCard }) {
  const t = useText();
  const { envelope } = useDraftView();
  const picked = usePostedOptions();
  const focus = useFocusField(["date", "hour"]);
  const date = card.fields.find((box) => box.id === "date");
  const dateValue = usePostedValue("date", date?.value ?? null);
  const hourValue = usePostedValue("hour", null);
  const dateProblem = problemOf(envelope, "date");
  const dateTarget = focus === "date" ? dateFocusTarget(picked) : null;
  const refused = dateProblem ? errorIdOf("date") : undefined;
  const option = (id: string) => card.options.find((choice) => choice.id === id);
  const days = DAYS.flatMap((id) => card.options.filter((choice) => choice.id === id));
  return (
    <CardShell
      card={card}
      title={t(card.titleKey, card.params)}
      prompt={card.promptKey ? t(card.promptKey, card.params) : null}
      focusId={dateTarget ?? focus}
    >
      <TurnForm>
        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="sr-only">{t("card.timeCard.date")}</legend>
          <div className="grid grid-cols-1 gap-2 @tiles:grid-cols-2">
            {days.map(({ id, labelKey }) => (
              <TileCheck
                key={id}
                id={`day-${id}`}
                type="radio"
                name="optionIds"
                value={id}
                checked={picked?.includes(id) ?? false}
                autoFocus={dateTarget === `day-${id}`}
                describedBy={refused}
                label={t(labelKey)}
              />
            ))}
          </div>
          <Field
            id="date"
            label={t("card.timeCard.date")}
            problem={null}
            focus={dateTarget === "date"}
            className="reveal-other-date min-w-0 flex-col gap-1.5"
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                aria-invalid={dateProblem ? true : undefined}
                aria-describedby={refused}
                min={String(date?.min ?? "")}
                max={String(date?.max ?? "")}
                defaultValue={dateValue}
                className="w-auto max-w-full tabular-nums"
              />
            )}
          </Field>
          <FieldError id="date" problem={dateProblem} />
        </fieldset>
        <div className="hide-when-older flex flex-col gap-3">
          <Field
            id="hour"
            label={t("card.timeCard.hour")}
            problem={problemOf(envelope, "hour")}
            focus={focus === "hour"}
            className="dim-when-hour-unknown flex min-w-0 flex-col gap-1.5 transition-opacity duration-150 motion-reduce:transition-none"
          >
            {(control) => (
              <div className="flex items-center gap-2">
                {/* The browser's own time box: digits only, 2131 reads as 21:31, a picker on a phone. */}
                <Input
                  {...control}
                  type="time"
                  autoComplete="off"
                  defaultValue={hourValue}
                  className="w-auto min-w-[8.5rem] tabular-nums"
                />
                <span className="text-body text-muted">{card.zone}</span>
              </div>
            )}
          </Field>
          <TileCheck
            type="checkbox"
            name="optionIds"
            value="hourUnknown"
            checked={picked?.includes("hourUnknown") ?? false}
            label={t(option("hourUnknown")?.labelKey ?? "card.timeCard.hourUnknown")}
          />
        </div>
        <SaveAction />
      </TurnForm>
    </CardShell>
  );
}

export function ChronologyReviewCard({ card }: { readonly card: Extract<Card, { kind: "chronologyReview" }> }) {
  const t = useText();
  const { envelope } = useDraftView();
  const focus = useFocusField(["note"]);
  const note = usePostedValue("note", null);
  const count = useCharCount(note);
  const box = card.fields[0];
  const max = box?.maxLength ?? 0;
  const text = card.chronology.kind === "chronology" ? card.chronology.text : "";
  return (
    <CardShell
      card={card}
      title={t(card.titleKey, card.params)}
      prompt={card.promptKey ? t(card.promptKey, card.params) : null}
      focusId={focus}
    >
      <p className="rounded-control bg-sunken p-3 text-body">{text}</p>
      <TurnForm>
        <details open={focus === "note" || note !== ""} className="group flex flex-col gap-3">
          <summary className="flex min-h-target cursor-pointer items-center rounded-control border border-control bg-surface px-4 font-semibold">
            {t("card.chronologyReview.add")}
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <Field
              id="note"
              label={t("card.chronologyReview.add")}
              hint={t("card.chronologyReview.noteHint")}
              problem={problemOf(envelope, "note")}
              focus={focus === "note"}
            >
              {(control) => <Textarea {...control} defaultValue={note} onInput={count.onInput} />}
            </Field>
            <p className="text-meta text-muted tabular-nums">{t("common.charCount", { length: count.length, max })}</p>
            <OptionAction id="add" labelKey="common.save" />
          </div>
        </details>
        <ActionRow>
          <OptionAction id="done" labelKey="card.chronologyReview.done" variant="primary" />
        </ActionRow>
      </TurnForm>
    </CardShell>
  );
}
