import type { Card } from "../contract/card";
import type { DraftBody } from "../contract/draft";
import { copy } from "../copy";
import { textFrom } from "../copy/text";
import { clockTime, type Instant, longDate } from "../copy/time";
import { hazardOf, precisionText, rowParts, rowView, valueLines } from "../copy/values";
import { firstLines, type NewsMessage } from "../domain/chat/news";
import type { Choice } from "../domain/chat/reply";
import type { ListedArea, ListedPlace } from "../domain/chat/step";
import type { AreaResults, PlaceResults } from "./places";

// Every card and notice of a report as the text of a chat message. WhatsApp shows *this* in bold.

export const t = textFrom(copy);

type CardOf<Kind extends Card["kind"]> = Extract<Card, { kind: Kind }>;
type CardOption = CardOf<"choice">["options"][number];

// The parts of a message, a blank line between two; a part with nothing to say is left out.
export const message = (...parts: readonly (string | null | undefined | false)[]): string =>
  parts.filter((part) => typeof part === "string" && part !== "").join("\n\n");

const lines = (...parts: readonly string[]) => parts.filter((part) => part !== "").join("\n");
const bold = (title: string) => t("whatsapp.title", { title });
const items = (texts: readonly string[]) => lines(...texts.map((text) => t("whatsapp.item", { text })));

export const numbered = (choices: readonly Choice[]): string =>
  lines(...choices.map((choice, index) => t("whatsapp.option", { n: String(index + 1), label: choice.label })));

// An abbreviation keeps its capitals.
const lowerFirst = (text: string) => text.replace(/^\p{Lu}(?=\p{Ll})/u, (letter) => letter.toLowerCase());

// What an option says on its line: a hazard's note is left out, as eleven of them fill the screen.
function optionLabel(option: CardOption, notes: boolean): string {
  const label = t(option.labelKey);
  if (option.guess) return t("whatsapp.guess", { label });
  return notes && option.noteKey && !label.includes("(") ? `${label} (${lowerFirst(t(option.noteKey))})` : label;
}

const choiceOf = (option: CardOption, notes: boolean): Choice => ({
  id: option.id,
  label: optionLabel(option, notes),
  freeText: option.freeTextMaxLength !== null,
});

const MEANS: Readonly<Record<string, Choice["means"]>> = { confirm: "yes", other: "no", yes: "yes", no: "no" };

// The numbered answers of a card, in the order its message lists them: what a number in the reply means.
export function cardChoices(card: Card): Choice[] {
  switch (card.kind) {
    case "choice":
    case "multiChoice": {
      const notes = card.fieldId !== "hazardType";
      return card.options.map((option) => ({
        ...choiceOf(option, notes),
        ...(card.fieldId === "emergencyVictims" ? { means: MEANS[option.id] } : {}),
      }));
    }
    case "chronologyStep":
      return card.options.map((option) => choiceOf(option, false));
    case "placeConfirm":
      return card.nearby === null
        ? card.options.map((option) => ({ ...choiceOf(option, false), means: MEANS[option.id] }))
        : card.nearby.map((one) => ({
            id: one.code,
            label: t("whatsapp.placeConfirm.row", { village: one.villageName, district: one.districtName, km: one.km }),
          }));
    case "timeCard":
      return ["today", "yesterday", "olderThan30Days"].map((id) => ({ id, label: t(`card.timeCard.${id}`) }));
    case "chronologyReview":
      return [{ id: "done", label: t("whatsapp.chronologyReview.done"), means: "no" }];
    case "photos":
      return card.options.map((option) => ({
        id: option.id,
        label: t(option.id === "continue" ? "whatsapp.photos.continue" : "whatsapp.photos.skip"),
        means: option.id === "continue" ? undefined : "no",
      }));
    case "summary":
      return [
        { id: "send", label: t(card.followUp ? "whatsapp.news.send" : "whatsapp.summary.send") },
        { id: "edit", label: t("whatsapp.summary.edit") },
        { id: "cancel", label: t(card.followUp ? "whatsapp.news.cancel" : "whatsapp.summary.cancel") },
      ];
    // The confirm card; no other card with no list of its own is answered by a number.
    default:
      return [
        { id: "accept", label: t("whatsapp.confirm.accept"), means: "yes" },
        { id: "back", label: t("whatsapp.confirm.back"), means: "no" },
      ];
  }
}

// The parts of a report "Ubah" may open, in the summary's order.
export function groupChoices(card: CardOf<"summary">): Choice[] {
  const groups = card.groups.map(({ groupId }) => ({ id: groupId, label: t(`group.${groupId}.label`) }));
  return card.followUp?.mayAddPhotos ? [...groups, { id: "photos", label: t("whatsapp.edit.photos") }] : groups;
}

const placeLines = (village: CardOf<"placeConfirm">["village"]) =>
  lines(
    t("card.placeSearch.rowVillage", { village: village.villageName }),
    t("card.placeSearch.rowPlace", {
      district: village.districtName,
      regency: village.regencyName,
      province: village.provinceName,
    }),
  );

function placeConfirmText(card: CardOf<"placeConfirm">): string {
  const choices = numbered(cardChoices(card));
  if (card.nearby !== null) return message(bold(t(card.titleKey)), choices, t("whatsapp.placeConfirm.nearby"));
  return message(
    lines(bold(t(card.titleKey)), placeLines(card.village), precisionText(t, card.precision, card.point.accuracyM)),
    card.promptKey && t(card.promptKey),
    choices,
  );
}

const NUMBERS_EXAMPLE = ["2", "0", "5", "0"];

function numbersText(card: CardOf<"numberForm">): string {
  const asked = card.fields.map((field) =>
    field.value === null
      ? t("whatsapp.numbers.item", { label: t(field.labelKey) })
      : t("whatsapp.numbers.itemKnown", { label: t(field.labelKey), value: String(field.value) }),
  );
  const [only] = card.fields;
  const question = only && copy.has(`field.${only.id}.question`) ? t(`field.${only.id}.question`) : null;
  const title = bold(t(card.titleKey));
  if (card.fields.length === 1) return message(lines(title, question ?? asked.join()), t("whatsapp.numbers.one"));
  return message(
    // Every group of counts has its question.
    lines(title, t(card.promptKey as string)),
    items(asked),
    t("whatsapp.numbers.many", {
      count: card.fields.length,
      example: NUMBERS_EXAMPLE.slice(0, card.fields.length).join(" "),
      sentence: t(`whatsapp.numbers.sentence.${card.groupId}`),
    }),
  );
}

// The second half of an answer, asked on its own.
export const hourText = (zone: string): string => t("whatsapp.hour.ask", { zone });
export const otherText = (label: string): string => t("whatsapp.other.ask", { label });

function choiceText(card: CardOf<"choice" | "multiChoice" | "chronologyStep">): string {
  const title = card.kind === "chronologyStep" ? t(card.titleKey, card.params) : bold(t(card.titleKey, card.params));
  const prompt = card.promptKey && t(card.promptKey, card.params);
  const many = card.kind === "multiChoice" || (card.kind === "chronologyStep" && card.multiple);
  return message(
    card.kind === "chronologyStep" ? lines(title, bold(prompt as string)) : lines(title, prompt ?? ""),
    numbered(cardChoices(card)),
    t(many ? "whatsapp.hint.many" : "whatsapp.hint.one"),
  );
}

function photosText(card: CardOf<"photos">): string {
  const last = card.photos.at(-1);
  const placed = last !== undefined && last.badge !== "none";
  return message(
    last === undefined
      ? lines(bold(t(card.titleKey)), t("whatsapp.photos.ask", { max: card.max }))
      : t("whatsapp.photos.kept", {
          count: card.photos.length,
          max: card.max,
          badge: t(`card.photos.badge.${last.badge}`) + (last.far ? `, ${lowerFirst(t("card.photos.badge.far"))}` : ""),
        }),
    !placed && t("whatsapp.photos.locate"),
    numbered(cardChoices(card)),
  );
}

const rowLine = (row: CardOf<"summary">["groups"][number]["rows"][number], hazardType: string | null): string => {
  const view = rowView(t, row, hazardType);
  return view.kind === "value" ? view.text : `${view.before}${t(`state.${view.state}`)}`;
};

// A part of the report; one value that is called what its part is called says it once.
function groupLines(group: CardOf<"summary">["groups"][number], hazardType: string | null): string {
  const title = t(`group.${group.groupId}.label`);
  const [first] = group.rows.map((row) => rowLine(row, hazardType));
  const only = group.rows.length === 1 && first?.startsWith(`${title}: `) ? first.slice(title.length + 2) : null;
  return lines(bold(title), ...(only === null ? group.rows.map((row) => rowLine(row, hazardType)) : [only]));
}

// A value before and after, each in the summary's words.
function changeLine(change: ValueChange, hazardType: string | null): string {
  const word = (row: SummaryRow | null) => {
    const parts = row && rowParts(t, row, hazardType);
    if (!parts) return t("state.notYetKnown");
    return parts.state === "value" ? (parts.value as string) : t(`state.${parts.state}`);
  };
  const label = t(t.variant(`field.${change.fieldId}.label`, hazardType));
  return t("whatsapp.news.change", { label, from: word(change.from), to: word(change.to) });
}

type SummaryRow = CardOf<"summary">["groups"][number]["rows"][number];
type ValueChange = NonNullable<CardOf<"summary">["followUp"]>["changes"][number];

function followUpText(card: CardOf<"summary">, followUp: NonNullable<CardOf<"summary">["followUp"]>): string {
  const told = followUp.changes.map((change) => changeLine(change, followUp.hazardType));
  if (card.photos.count > 0) told.push(t("whatsapp.news.photos", { count: card.photos.count }));
  return message(
    lines(bold(t("whatsapp.news.title", { ticketNumber: followUp.ticketNumber })), t("whatsapp.news.ask")),
    told.length === 0 ? t("whatsapp.news.nothing") : lines(bold(t("whatsapp.news.willSend")), items(told)),
    numbered(cardChoices(card)),
  );
}

function summaryText(card: CardOf<"summary">): string {
  if (card.followUp) return followUpText(card, card.followUp);
  const hazardType = hazardOf(card.groups);
  const { photos } = card;
  return message(
    lines(
      bold(t("whatsapp.summary.title", { percent: card.params.percent as number })),
      t("card.summary.reporter", {
        name: card.reporter.name,
        role: t(card.reporter.role === "citizen" ? "identity.role.citizen" : "identity.role.officer"),
      }),
    ),
    card.emergency &&
      lines(
        bold(t("card.emergency.summary")),
        t("card.emergency.summaryVictims", { victims: t(`card.emergency.victims.${card.emergency.victims}`) }),
      ),
    ...card.groups.map((group) => groupLines(group, hazardType)),
    photos.count === 0
      ? t("card.summary.noPhotos")
      : t("card.summary.photos", { count: photos.count, withPlace: photos.withPlace }),
    numbered(cardChoices(card)),
    t("whatsapp.summary.hint"),
  );
}

// A card that is still being answered, as its question.
export function cardText(card: Card): string {
  switch (card.kind) {
    case "placeSearch":
      return lines(bold(t(card.titleKey)), t("whatsapp.place.ask"));
    case "placeConfirm":
      return placeConfirmText(card);
    case "neighbourhood":
      return lines(bold(t(card.titleKey)), t("whatsapp.neighbourhood.ask"));
    case "choice":
    case "multiChoice":
    case "chronologyStep":
      return choiceText(card);
    case "numberForm":
      return numbersText(card);
    case "timeCard":
      return message(
        lines(bold(t(card.titleKey)), t("whatsapp.time.ask", { zone: card.zone })),
        numbered(cardChoices(card)),
        t("whatsapp.time.hint"),
      );
    case "textQuestion":
      return message(
        lines(bold(t(card.titleKey)), t(card.promptKey as string)),
        t("whatsapp.text.ask", { max: card.params.max as number }),
      );
    case "chronologyReview":
      return message(
        lines(bold(t(card.titleKey)), ...valueLines(t, "chronology", card.chronology)),
        t("whatsapp.chronologyReview.ask"),
      );
    case "photos":
      return photosText(card);
    case "summary":
      return summaryText(card);
    case "confirm":
      return message(
        lines(bold(t(card.titleKey)), t(card.promptKey as string, card.params)),
        numbered(cardChoices(card)),
      );
    case "followUpEnded":
      return t("whatsapp.news.cancelled", { ticketNumber: card.ticketNumber });
    default:
      return t("whatsapp.cancelled");
  }
}

// The question again after something else was said. The whole summary is asked for, not repeated.
export function askedAgain(card: Card): string {
  if (card.kind !== "summary" || card.followUp) return cardText(card);
  const title = bold(t("whatsapp.summary.title", { percent: card.params.percent as number }));
  return message(title, numbered(cardChoices(card)), t("whatsapp.summary.again"));
}

// What a turn raised, above its question: the 112 line, a warning, a refusal.
export const noticesText = (notices: DraftBody["notices"]): string =>
  message(...notices.map((notice) => t(notice.copyKey, notice.params)));

// What staff did, as one message of the report's chat.
export type ChatNews = Pick<NewsMessage, "ticketNumber" | "status" | "actions" | "reply" | "corrected"> & {
  readonly at: Instant;
  // What a check put right, each value before and after.
  readonly changes: readonly ValueChange[];
  readonly hazardType: string;
};

const cutItems = (texts: readonly string[]): string => {
  const { shown, left } = firstLines(texts);
  return items(left === 0 ? shown : [...shown, t("whatsapp.kabar.more", { count: left })]);
};

// Its parts, without the title and the foot: what the status of a report tells too.
export function newsParts(news: Omit<ChatNews, "ticketNumber" | "at">): string {
  const { status, actions, reply, corrected, changes, hazardType } = news;
  return message(
    status &&
      lines(
        t("whatsapp.kabar.status", { status: t(`stage.long.${status.status}`) }),
        status.reason === null ? "" : t("whatsapp.kabar.reason", { reason: status.reason }),
      ),
    actions.length > 0 && lines(bold(t("whatsapp.kabar.actions")), cutItems(actions)),
    reply !== null && lines(bold(t("whatsapp.kabar.reply")), reply),
    corrected !== null &&
      lines(bold(t("whatsapp.kabar.correction")), cutItems(changes.map((change) => changeLine(change, hazardType)))),
  );
}

const ENDED: readonly string[] = ["closed", "invalid"];

export function newsText(news: ChatNews, link: string): string {
  const { ticketNumber, at, status } = news;
  return message(
    t("whatsapp.kabar.title", { ticketNumber, date: longDate(at), time: clockTime(at), zone: at.zone }),
    newsParts(news),
    status !== null && ENDED.includes(status.status) && t("whatsapp.sent.track", { link }),
    t("whatsapp.kabar.stop"),
  );
}

// The places a name matched, as a numbered list, and which one each number is.
export function placesText(
  found: PlaceResults | AreaResults,
  query: string,
): { readonly text: string; readonly places: ListedPlace[]; readonly area: ListedArea | null } {
  if (found.items.length === 0) return { text: t("whatsapp.place.none", { query }), places: [], area: null };
  const area = "area" in found ? found.area : null;
  const choices = found.items.map((item) => ({
    id: item.code,
    label: t(`whatsapp.place.${item.level}`, {
      village: item.name,
      district: item.level === "district" ? item.name : (item.districtName ?? ""),
      regency: item.level === "regency" ? item.name : item.regencyName,
      province: item.provinceName,
    }),
  }));
  const shown = found.items.length;
  const cut = t(area === null ? "whatsapp.place.cut" : "whatsapp.place.areaCut", { shown, total: found.total });
  return {
    text: message(
      area === null
        ? t("whatsapp.place.matches", { count: found.total, query })
        : t("whatsapp.place.area", { areaName: area.name }),
      numbered(choices),
      found.cut && cut,
      t("whatsapp.place.pick"),
    ),
    places: found.items.map(({ level, code }) => ({ level, code })),
    area: area && { level: area.level, code: area.code },
  };
}
