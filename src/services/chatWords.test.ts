import { describe, expect, test } from "vitest";
import type { Card } from "../contract/card";
import { readChoice } from "../domain/chat/reply";
import { cardChoices, cardText } from "./chatWords";

const option = (id: string, labelKey: string) => ({
  id,
  labelKey,
  noteKey: null,
  exclusive: false,
  danger: false,
  freeTextMaxLength: null,
});
const sameEvent = (ids: string[]): Card => ({
  cardId: "c-1",
  kind: "choice",
  titleKey: "card.sameEvent.title",
  promptKey: "card.sameEvent.prompt",
  params: { district: "Baktiya", offers: "banjir sejak 26 November 2026, 08.24 WIB dari 2 warga" },
  fieldId: "sameEvent",
  options: [...ids.map((id) => option(id, `card.sameEvent.yes.${id}`)), option("none", "card.sameEvent.no")],
});

describe("the same event in a chat", () => {
  test("asked with the reports in words; ya joins the one offered, bukan is a report of its own", () => {
    const card = sameEvent(["flood"]);
    expect(cardText(card)).toContain("*Kejadian yang sama?*\nDi Kec. Baktiya sudah ada laporan banjir sejak");
    const choices = cardChoices(card);
    expect(readChoice("ya", choices)).toMatchObject({ kind: "picked", ids: ["flood"] });
    expect(readChoice("bukan", choices)).toMatchObject({ kind: "picked", ids: ["none"] });
  });

  test("with two offered, ya says nothing on its own: the number does", () => {
    const choices = cardChoices(sameEvent(["flood", "drought"]));
    expect(readChoice("ya", choices)).toEqual({ kind: "words" });
    expect(readChoice("2", choices)).toMatchObject({ kind: "picked", ids: ["drought"] });
    expect(readChoice("tidak", choices)).toMatchObject({ kind: "picked", ids: ["none"] });
  });
});
