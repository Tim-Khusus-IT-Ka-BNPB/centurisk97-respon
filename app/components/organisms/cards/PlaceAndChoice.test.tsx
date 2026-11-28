import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { Card } from "../../../../src/contract/card";
import type { DraftBody } from "../../../../src/contract/draft";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { SAMPLE_DRAFTS } from "../../../../src/testing/samples";
import { never, renderDraft } from "../../../testing/render";
import { CardView } from "../CardView";

const withCard = (card: Card, extra: Partial<DraftBody> = {}): DraftBody => ({
  ...SAMPLE_DRAFTS.choice,
  card,
  ...extra,
});
const placeCard = SAMPLE_DRAFTS.placeSearch.card as Extract<Card, { kind: "placeSearch" }>;
type Places = NonNullable<typeof placeCard.places>;
const envelope = (code: string, copyKey: string, fields: ErrorEnvelope["fields"] = []): ErrorEnvelope =>
  ({ error: { code, copyKey, params: {} }, fields, retryAt: null, draft: null }) as ErrorEnvelope;

describe("place search", () => {
  test("an empty search shows the prompt and hint, and the heading takes focus", async () => {
    renderDraft(<CardView card={{ ...placeCard, query: null, places: null }} />, SAMPLE_DRAFTS.placeSearch);
    const heading = await screen.findByRole("heading", { name: "Lokasi kejadian" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByText("Ketik paling sedikit 3 huruf.")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Cari tempat" }).getAttribute("name")).toBe("q");
  });

  test("results list the count and the cut, area rows open their villages, village rows answer", async () => {
    const places: Places = {
      ...(placeCard.places as Places),
      items: [
        {
          level: "district",
          code: "11.08.01",
          name: "Contoh",
          districtName: null,
          regencyName: "Aceh Utara",
          provinceName: "Aceh",
        },
        ...(placeCard.places as Places).items,
      ],
    };
    renderDraft(<CardView card={{ ...placeCard, places }} />, SAMPLE_DRAFTS.placeSearch, { action: never });
    expect(await screen.findByText(/2 dari 71 tempat cocok/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Kec\. Contoh, Aceh Utara, Aceh: lihat desa/ }).getAttribute("href"),
    ).toContain("?area=11.08.01");
    const village = screen.getByRole("button", { name: /Desa\/Kel\. Sukamaju/ });
    expect(village.getAttribute("name")).toBe("villageCode");
    expect(screen.getByText("Data wilayah per 25 Oktober 2026.")).toBeTruthy();
    expect(document.activeElement?.id).toBe("q");
    fireEvent.click(village);
    await waitFor(() => expect(village.textContent).toBe("Menyimpan jawaban..."));
    fireEvent.click(village);
  });

  test("a place the reporter named arrives searched, its words in the box, with the keyboard closed", async () => {
    renderDraft(
      <CardView card={{ ...placeCard, query: "desa Sukamaju", named: true }} />,
      SAMPLE_DRAFTS.placeSearch,
    );
    const heading = await screen.findByRole("heading", { name: "Lokasi kejadian" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect((screen.getByRole("searchbox", { name: "Cari tempat" }) as HTMLInputElement).value).toBe("desa Sukamaju");
    expect(screen.getByRole("button", { name: /Desa\/Kel\. Sukamaju/ })).toBeTruthy();
  });

  test("places found by a close spelling say so", async () => {
    const places: Places = { ...(placeCard.places as Places), similar: true };
    renderDraft(<CardView card={{ ...placeCard, places }} />, SAMPLE_DRAFTS.placeSearch, { action: never });
    expect(await screen.findByText(/ejaan yang mirip/)).toBeTruthy();
  });

  test("a refused query sits under the box, tied to it, with focus on it", async () => {
    const refused = envelope("request.invalidFields", "error.request.invalidFields", [
      { fieldId: "q", copyKey: "fieldError.query.tooShort", params: {} },
    ]);
    renderDraft(<CardView card={{ ...placeCard, query: "su", places: null }} />, SAMPLE_DRAFTS.placeSearch, {
      envelope: refused,
    });
    const box = await screen.findByRole("searchbox");
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(box.getAttribute("aria-describedby")).toContain("q-error");
    expect(document.getElementById("q-error")?.textContent).toContain("terlalu pendek");
    expect(document.activeElement).toBe(box);
  });

  test("with place data down, the notice and the 112 line show and the draft stays here", async () => {
    renderDraft(<CardView card={{ ...placeCard, places: null }} />, SAMPLE_DRAFTS.placeSearch, {
      envelope: envelope("place.unavailable", "error.place.unavailable"),
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Pencarian tempat belum bisa dipakai");
    expect(screen.getByRole("link", { name: "Telepon 112" }).getAttribute("href")).toBe("tel:112");
  });

  test("a search on its way shows the loading line and placeholder rows", async () => {
    renderDraft(<CardView card={placeCard} />, SAMPLE_DRAFTS.placeSearch, {
      loader: ({ request }) => (new URL(request.url).searchParams.has("q") ? never() : null),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cari tempat" }));
    expect(await screen.findByText("Mencari tempat...")).toBeTruthy();
  });

  test("the villages of an area have a filter, two columns when wide, and a way back", async () => {
    const card = SAMPLE_DRAFTS.regencyVillages.card;
    renderDraft(<CardView card={card} />, SAMPLE_DRAFTS.regencyVillages, {
      loader: ({ request }) => (new URL(request.url).searchParams.has("q") ? never() : null),
    });
    expect(await screen.findByRole("heading", { name: "Desa di Aceh Utara" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Cari tempat lain" })).toBeTruthy();
    expect((document.querySelector('input[name="area"]') as HTMLInputElement).value).toBe("11.08");
    fireEvent.click(screen.getByRole("button", { name: "Saring desa" }));
    expect(await screen.findByText("Memuat desa...")).toBeTruthy();
  });

  test("an area search with no village rows draws no answer form", async () => {
    const card = SAMPLE_DRAFTS.regencyVillages.card as Extract<Card, { kind: "regencyVillages" }>;
    const places = { ...(card.places as Places), items: [], total: 0 };
    renderDraft(<CardView card={{ ...card, query: "x", places }} />, SAMPLE_DRAFTS.regencyVillages);
    expect(await screen.findByText(/Tidak ada desa di Aceh Utara/)).toBeTruthy();
    expect(document.querySelector('button[name="villageCode"]')).toBeNull();
  });
});

describe("choice cards", () => {
  const hazard = SAMPLE_DRAFTS.choice.card as Extract<Card, { kind: "choice" }>;

  test("hazard tiles answer on tap, each with its own icon and note; the tapped one is busy", async () => {
    renderDraft(<CardView card={hazard} />, SAMPLE_DRAFTS.choice, { action: never });
    const flood = await screen.findByRole("button", { name: /^Banjir/ });
    expect(flood.getAttribute("name")).toBe("optionIds");
    expect(flood.querySelector("svg")).toBeTruthy();
    fireEvent.click(flood);
    await waitFor(() => expect(flood.textContent).toContain("Menyimpan jawaban..."));
    fireEvent.click(flood);
  });

  test("a card with no options says so instead of drawing nothing", async () => {
    renderDraft(<CardView card={{ ...hazard, options: [] }} />, SAMPLE_DRAFTS.choice);
    expect(await screen.findByText(/Pilihan untuk pertanyaan ini tidak bisa dimuat/)).toBeTruthy();
  });

  test("a choice other than the hazard has no icons, and an option note shows only when it exists", async () => {
    const card: Card = {
      ...hazard,
      titleKey: "field.roadPassable.label",
      promptKey: null,
      fieldId: "roadPassable",
      options: [
        {
          id: "cutOff",
          labelKey: "option.roadPassable.cutOff.label",
          noteKey: "option.roadPassable.cutOff.note",
          exclusive: false,
          danger: false,
          freeTextMaxLength: null,
        },
        {
          id: "x",
          labelKey: "common.unknown",
          noteKey: "option.roadPassable.none.note",
          exclusive: false,
          danger: false,
          freeTextMaxLength: null,
        },
      ],
    };
    renderDraft(<CardView card={card} />, withCard(card));
    const cut = await screen.findByRole("button", { name: /Putus/ });
    expect(cut.querySelector("svg")).toBeNull();
    expect(cut.textContent).toContain("Harus memutar");
    expect(screen.getByRole("button", { name: "Tidak tahu" }).textContent).toBe("Tidak tahu");
  });

  test("a refused choice ties its error to the first tile and focuses it", async () => {
    const refused = envelope("request.invalidFields", "error.request.invalidFields", [
      { fieldId: "options", copyKey: "fieldError.required", params: { label: "field.hazardType.label" } },
    ]);
    renderDraft(<CardView card={hazard} />, SAMPLE_DRAFTS.choice, { envelope: refused });
    const first = await screen.findByRole("button", { name: /^Banjir/ });
    expect(document.activeElement).toBe(first);
    expect(screen.getByText(/Jenis bencana belum diisi/)).toBeTruthy();
  });

  test("several picks: exclusive options clear the rest with script, and the save is busy while sent", async () => {
    const multi = SAMPLE_DRAFTS.multiChoice.card;
    renderDraft(<CardView card={multi} />, SAMPLE_DRAFTS.multiChoice, {
      action: never,
      posted: { optionIds: ["elderly"] },
    });
    expect(await screen.findByText("Boleh pilih lebih dari satu.")).toBeTruthy();
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[name="optionIds"]')];
    expect(boxes.map((box) => box.checked)).toEqual([true, false, false]);
    fireEvent.click(boxes[1] as HTMLInputElement);
    expect(boxes.map((box) => box.checked)).toEqual([false, true, false]);
    fireEvent.click(screen.getByRole("button", { name: "Simpan jawaban" }));
    await screen.findByRole("button", { name: "Menyimpan jawaban..." });
  });

  test("a guided step shows its progress, the danger warning, and a typed Lainnya that opens by CSS", async () => {
    const step = SAMPLE_DRAFTS.chronologyStep.card as Extract<Card, { kind: "chronologyStep" }>;
    const card: Card = {
      ...step,
      multiple: false,
      options: [
        ...step.options,
        {
          id: "other",
          labelKey: "chronology.flood.step2.option.slowRise.label",
          noteKey: null,
          exclusive: false,
          danger: false,
          freeTextMaxLength: 300,
        },
      ],
    };
    const refused = envelope("request.invalidFields", "error.request.invalidFields", [
      { fieldId: "other", copyKey: "fieldError.required", params: { label: "common.unknown" } },
    ]);
    const draft = {
      ...SAMPLE_DRAFTS.chronologyStep,
      card,
      notices: [{ kind: "danger" as const, copyKey: "chronology.flood.step2.warning", params: {}, retryAt: null }],
    };
    renderDraft(<CardView card={card} />, draft, { envelope: refused, posted: { optionIds: ["other"], other: ["x"] } });
    expect(await screen.findByText("Cerita kejadian, langkah 2 dari 8.")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    const other = screen.getByRole("textbox");
    expect((other as HTMLInputElement).value).toBe("x");
    expect(document.activeElement).toBe(other);
    expect(screen.getByText(/300/)).toBeTruthy();
  });

  test("several chronology picks are checkboxes", async () => {
    const step = SAMPLE_DRAFTS.chronologyStep.card as Extract<Card, { kind: "chronologyStep" }>;
    renderDraft(<CardView card={{ ...step, multiple: true }} />, SAMPLE_DRAFTS.chronologyStep);
    expect(await screen.findAllByRole("checkbox")).toHaveLength(4);
  });

  test("the hazard subtype card names its hazard", async () => {
    const subtype: Card = {
      ...hazard,
      titleKey: "card.choice.hazardSubtype.title",
      promptKey: "card.choice.hazardSubtype.prompt",
      params: { hazardType: "hazard.flood.label" },
      fieldId: "hazardSubtype",
    };
    renderDraft(<CardView card={subtype} />, withCard(subtype));
    expect(await screen.findByText(/^Banjir seperti apa\?/)).toBeTruthy();
  });
});

describe("choice cards at the edges", () => {
  test("a refused multiple choice focuses its first box and marks every box invalid", async () => {
    const refused = envelope("request.invalidFields", "error.request.invalidFields", [
      { fieldId: "options", copyKey: "fieldError.required", params: { label: "field.vulnerableGroups.label" } },
    ]);
    renderDraft(<CardView card={SAMPLE_DRAFTS.multiChoice.card} />, SAMPLE_DRAFTS.multiChoice, { envelope: refused });
    const boxes = await screen.findAllByRole("checkbox");
    await waitFor(() => expect(document.activeElement).toBe(boxes[0]));
    expect(boxes.every((box) => box.getAttribute("aria-invalid") === "true")).toBe(true);
  });

  test("a guided step with no question key falls back to its title; a legacy hazard has no icon", async () => {
    const step = SAMPLE_DRAFTS.chronologyStep.card as Extract<Card, { kind: "chronologyStep" }>;
    renderDraft(<CardView card={{ ...step, promptKey: null }} />, SAMPLE_DRAFTS.chronologyStep);
    expect(await screen.findAllByText("Cerita kejadian, langkah 2 dari 8.")).toHaveLength(2);
    const hazard = SAMPLE_DRAFTS.choice.card as Extract<Card, { kind: "choice" }>;
    const legacy = { ...hazard, options: [{ ...(hazard.options[0] as (typeof hazard.options)[number]), id: "other" }] };
    renderDraft(<CardView card={legacy} />, SAMPLE_DRAFTS.choice);
    expect((await screen.findByRole("button", { name: /Banjir/ })).querySelector("svg")).toBeNull();
  });
});
