import type { Card } from "../contract/card";
import { copy } from "../copy";
import { chronologySteps, isExclusive } from "../domain/chronology";
import type { ChronologyAnswers } from "../domain/chronology/sentence";
import { VICTIM_ANSWERS } from "../domain/emergency";
import { localDate, type Zone } from "../domain/eventTime";
import type { FieldState } from "../domain/fieldState";
import { chosenHazardType } from "../domain/fields/applicable";
import { type FieldId, fieldById } from "../domain/fields/catalogue";
import type { HazardTypeId } from "../domain/hazards";
import { LENGTHS } from "../domain/limits";
import type { KeptPhoto } from "../domain/photoChecks";
import { PHOTO } from "../domain/photoChecks";
import { DAY_MS, MINUTE_MS } from "../domain/time";
import type { AskedCounts, DraftContent, PlaceReading, Question } from "../domain/turn/content";
import { choiceOptions, isExclusiveOption } from "../domain/turn/options";
import { chronologyRow, summaryGroups } from "./summary";

type CardField = Extract<Card, { kind: "numberForm" }>["fields"][number];
type CardOption = Extract<Card, { kind: "choice" }>["options"][number];

// A per-hazard variant of a key ("field.farmland.label.flood") when the catalogue has one.
function variantKey(key: string, hazardType: HazardTypeId | null): string {
  const variant = `${key}.${hazardType}`;
  return hazardType !== null && copy.has(variant) ? variant : key;
}

const keyIfAny = (key: string) => (copy.has(key) ? key : null);

function box(
  id: string,
  labelKey: string,
  inputKind: CardField["inputKind"],
  state?: FieldState,
  extra: Partial<CardField> = {},
): CardField {
  let value: string | number | null = null;
  if (state?.state === "none") value = 0;
  else if (state?.state === "value" && (typeof state.value === "number" || typeof state.value === "string"))
    value = state.value;
  return {
    id,
    inputKind,
    labelKey,
    definitionKey: null,
    min: null,
    max: null,
    maxLength: null,
    value,
    state: state?.state ?? "notAsked",
    origin: state && "origin" in state ? state.origin : null,
    askedBefore: false,
    ...extra,
  };
}

function option(id: string, labelKey: string, noteKey: string | null, extra: Partial<CardOption> = {}): CardOption {
  return { id, labelKey, noteKey, exclusive: false, danger: false, guess: false, freeTextMaxLength: null, ...extra };
}

type CardBase = { readonly cardId: string; readonly params: Readonly<Record<string, string | number>> };

function choiceCard(base: CardBase, fieldId: FieldId, content: DraftContent, multiple: boolean): Card {
  const hazardType = chosenHazardType(content.states);
  if (fieldId === "hazardType") {
    const ids = choiceOptions("hazardType", content.states).map((choice) => choice.id);
    const ordered = [
      ...content.guesses.filter((id) => ids.includes(id)),
      ...ids.filter((id) => !content.guesses.includes(id as HazardTypeId)),
    ];
    return {
      ...base,
      kind: "choice",
      titleKey: content.emergency ? "card.emergency.type.title" : "card.choice.hazardType.title",
      promptKey: "card.choice.hazardType.prompt",
      fieldId,
      options: ordered.map((id) =>
        option(id, `hazard.${id}.label`, keyIfAny(`hazard.${id}.note`), {
          guess: content.guesses.includes(id as HazardTypeId),
        }),
      ),
    };
  }
  if (fieldId === "hazardSubtype") {
    const prefix = `hazardSubtype.${hazardType}`;
    return {
      ...base,
      kind: "choice",
      titleKey: "card.choice.hazardSubtype.title",
      promptKey: "card.choice.hazardSubtype.prompt",
      params: { hazardType: `hazard.${hazardType}.label` },
      fieldId,
      options: choiceOptions(fieldId, content.states).map((choice) =>
        option(choice.id, `${prefix}.${choice.id}.label`, keyIfAny(`${prefix}.${choice.id}.note`)),
      ),
    };
  }
  const options = choiceOptions(fieldId, content.states).map((choice) => {
    const key = `option.${fieldId}.${choice.id}`;
    // Only the "Tidak tahu" choice borrows the shared label; every other choice has its own key.
    const labelKey = choice.id === "unknown" ? "common.unknown" : `${key}.label`;
    return option(choice.id, labelKey, keyIfAny(`${key}.note`), {
      exclusive: multiple && isExclusiveOption(choice),
      freeTextMaxLength: choice.freeTextMaxLength ?? null,
    });
  });
  return {
    ...base,
    kind: multiple ? "multiChoice" : "choice",
    titleKey: variantKey(`field.${fieldId}.label`, hazardType),
    promptKey: keyIfAny(variantKey(`field.${fieldId}.question`, hazardType)),
    fieldId,
    options,
  };
}

function chronologyStepCard(base: CardBase, step: number, content: DraftContent): Card {
  const hazardType = chosenHazardType(content.states) as HazardTypeId;
  const steps = chronologySteps(hazardType);
  const definition = steps[step] as (typeof steps)[number];
  const prefix = `chronology.${hazardType}.step${step + 1}`;
  return {
    ...base,
    kind: "chronologyStep",
    titleKey: "card.chronologyStep.progress",
    promptKey: `${prefix}.question`,
    params: { step: step + 1, total: steps.length },
    hazardType,
    step: step + 1,
    total: steps.length,
    multiple: definition.multiple,
    options: definition.options.map((choice) =>
      option(choice.id, `${prefix}.option.${choice.id}.label`, null, {
        exclusive: isExclusive(definition, choice),
        danger: choice.danger === true,
        freeTextMaxLength: choice.freeText ? LENGTHS.chronologyNote.max : null,
      }),
    ),
  };
}

function numberCard(base: CardBase, question: Extract<Question, { kind: "numberForm" }>, content: DraftContent): Card {
  const hazardType = chosenHazardType(content.states);
  return {
    ...base,
    kind: "numberForm",
    titleKey: `group.${question.groupId}.label`,
    promptKey: keyIfAny(variantKey(`group.${question.groupId}.prompt`, hazardType)),
    groupId: question.groupId,
    fields: question.fieldIds.map((fieldId) => {
      const field = fieldById(fieldId) as { max: number };
      return box(fieldId, variantKey(`field.${fieldId}.label`, hazardType), "integer", content.states[fieldId], {
        definitionKey: keyIfAny(variantKey(`field.${fieldId}.definition`, hazardType)),
        min: 0,
        max: field.max,
        askedBefore: question.askedBefore,
      });
    }),
    formActions: ["allNone", "allUnknown"],
  };
}

export type CardContext = {
  readonly cardId: string;
  readonly nowMs: number;
  readonly zone: Zone;
  readonly reporter: { readonly name: string; readonly role: "citizen" | "claimedOfficer" };
  readonly completePercent: number;
  readonly asked: AskedCounts;
  // The draft's photos in the order they arrived.
  readonly photos: readonly (KeptPhoto & { readonly id: string })[];
};

const readVillage = (village: PlaceReading["village"]) => ({
  code: village.villageCode,
  villageName: village.villageName,
  districtName: village.districtName,
  regencyName: village.regencyName,
  provinceName: village.provinceName,
});

function placeConfirmCard(base: CardBase, reading: PlaceReading): Card {
  const point = reading.village.point as NonNullable<PlaceReading["village"]["point"]>;
  return {
    ...base,
    kind: "placeConfirm",
    titleKey: reading.showNearby ? "card.placeConfirm.nearbyTitle" : "card.placeConfirm.title",
    promptKey: reading.showNearby ? "card.placeConfirm.nearbyPrompt" : "card.placeConfirm.prompt",
    village: readVillage(reading.village),
    point,
    precision: reading.village.precision === "gpsPoint" ? "gpsPoint" : "estimate",
    options: reading.showNearby
      ? []
      : [option("confirm", "card.placeConfirm.confirm", null), option("other", "card.placeConfirm.other", null)],
    nearby: reading.showNearby ? reading.nearby.map((one) => ({ ...readVillage(one.village), km: one.km })) : null,
  };
}

function photosCard(base: CardBase, context: CardContext): Card {
  const count = context.photos.length;
  return {
    ...base,
    kind: "photos",
    titleKey: "card.photos.title",
    promptKey: "card.photos.prompt",
    params: { count, max: PHOTO.maxPerDraft },
    photos: context.photos.map((photo) => ({
      photoId: photo.id,
      badge: photo.badge,
      far: photo.far,
      takenAt: { utc: new Date(photo.takenAtMs).toISOString(), zone: context.zone },
      timeSource: photo.timeSource,
      point: photo.point,
      accuracyM: photo.accuracyM,
    })),
    max: PHOTO.maxPerDraft,
    options: [
      count > 0
        ? option("continue", "card.photos.continue", null)
        : option("cannotSend", "card.photos.cannotSend", null),
    ],
  };
}

// The card for the question code picked. Copy keys only; the client fills the text.
export function cardFor(question: Question, content: DraftContent, context: CardContext): Card {
  const base: CardBase = { cardId: context.cardId, params: {} };
  const hazardType = chosenHazardType(content.states);
  switch (question.kind) {
    case "placeConfirm":
      return placeConfirmCard(base, content.placeReading as PlaceReading);
    case "photos":
      return photosCard(base, context);
    case "place":
      return {
        ...base,
        kind: "placeSearch",
        titleKey: "card.placeSearch.title",
        promptKey: "card.placeSearch.prompt",
        query: null,
        places: null,
      };
    case "emergencyVictims":
      return {
        ...base,
        kind: "choice",
        titleKey: "card.emergency.victims.title",
        promptKey: null,
        fieldId: "emergencyVictims",
        options: VICTIM_ANSWERS.map((id) => option(id, `card.emergency.victims.${id}`, null)),
      };
    case "neighbourhood":
      return {
        ...base,
        kind: "neighbourhood",
        titleKey: "card.neighbourhood.title",
        promptKey: "card.neighbourhood.prompt",
        fields: (["rt", "rw"] as const).map((id) =>
          box(id, `field.neighbourhood.${id}`, "digits", undefined, { maxLength: LENGTHS.neighbourhood.max }),
        ),
      };
    case "choice":
      return choiceCard(base, question.fieldId, content, false);
    case "multiChoice":
      return choiceCard(base, question.fieldId, content, true);
    case "chronologyStep":
      return chronologyStepCard(base, question.step, content);
    case "chronologyReview":
      return {
        ...base,
        kind: "chronologyReview",
        titleKey: "card.chronologyReview.title",
        promptKey: "card.chronologyReview.prompt",
        chronology: chronologyRow(hazardType as HazardTypeId, content.chronology as ChronologyAnswers, null),
        fields: [
          box("note", "card.chronologyReview.noteHint", "text", undefined, { maxLength: LENGTHS.chronologyNote.max }),
        ],
      };
    case "eventTime":
      return {
        ...base,
        kind: "timeCard",
        titleKey: "card.timeCard.title",
        promptKey: "card.timeCard.prompt",
        params: { zone: context.zone },
        zone: context.zone,
        fields: [
          box("date", "card.timeCard.date", "date", undefined, {
            min: localDate(context.nowMs - 30 * DAY_MS, context.zone),
            max: localDate(context.nowMs + 10 * MINUTE_MS, context.zone),
          }),
          box("hour", "card.timeCard.hour", "hour"),
        ],
        options: ["today", "yesterday", "otherDate", "hourUnknown", "olderThan30Days"].map((id) =>
          option(id, `card.timeCard.${id}`, null),
        ),
      };
    case "numberForm":
      return numberCard(base, question, content);
    case "textQuestion": {
      const { maxLength: max } = fieldById(question.fieldId) as { maxLength: number };
      return {
        ...base,
        kind: "textQuestion",
        titleKey: variantKey(`field.${question.fieldId}.label`, hazardType),
        promptKey: keyIfAny(variantKey(`field.${question.fieldId}.question`, hazardType)),
        params: { max },
        fieldId: question.fieldId,
        fields: [
          box(
            question.fieldId,
            variantKey(`field.${question.fieldId}.label`, hazardType),
            "text",
            content.states[question.fieldId],
            { maxLength: max, askedBefore: question.askedBefore },
          ),
        ],
      };
    }
    case "summary":
      return {
        ...base,
        kind: "summary",
        titleKey: "card.summary.title",
        promptKey: null,
        params: { percent: context.completePercent },
        reporter: context.reporter,
        groups: summaryGroups(content.states),
        emergency: content.emergency ?? null,
        photos: {
          count: context.photos.length,
          withPlace: context.photos.filter((photo) => photo.point !== null).length,
        },
      };
    default:
      return {
        ...base,
        kind: "confirm",
        titleKey: "card.confirm.cancelDraft.title",
        promptKey: "card.confirm.cancelDraft.body",
        confirmId: "cancelDraft",
      };
  }
}
