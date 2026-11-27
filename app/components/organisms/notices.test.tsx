import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { Card } from "../../../src/contract/card";
import type { DraftBody } from "../../../src/contract/draft";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import { SAMPLE_DRAFTS, SAMPLE_ME } from "../../../src/testing/samples";
import type { DraftPageData } from "../../lib/draftTypes";
import type { StartActionData, StartPageData } from "../../lib/startTypes";
import { ALL_TEXTS, never, renderDraft, renderPage } from "../../testing/render";
import { CardView } from "./CardView";
import { DraftScreen } from "./DraftScreen";
import { StartScreen } from "./StartScreen";

type Notice = DraftBody["notices"][number];
const notice = (kind: Notice["kind"], copyKey: string): Notice => ({ kind, copyKey, params: {}, retryAt: null });
const LIFE = notice("lifeLine", "notice.lifeLine");
const RESUMED = notice("resumed", "notice.resumed");
const page = (draft: DraftBody) =>
  ({ kind: "draft", draft, envelope: null, turnKey: "k-1", texts: ALL_TEXTS }) as Extract<
    DraftPageData,
    { kind: "draft" }
  >;
const withTranscript = (draft: DraftBody): DraftBody => ({
  ...draft,
  transcript: [
    ...draft.transcript,
    {
      speaker: "assistant",
      cardKind: draft.card.kind,
      copyKey: draft.card.titleKey,
      params: draft.card.params,
      at: draft.keptUntil,
    },
  ],
});

describe("notices the page read carries", () => {
  test("a resumed read shows the resumed notice with kept-until and the 112 panel", async () => {
    renderPage(<DraftScreen page={page({ ...SAMPLE_DRAFTS.numberForm, notices: [LIFE, RESUMED] })} acted={null} />);
    expect(await screen.findByText("Laporan dilanjutkan dari jawaban terakhir Anda.")).toBeTruthy();
    // Once in the resumed notice, once in the wide-screen progress panel.
    expect(screen.getAllByText(/disimpan sampai/)).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Telepon 112" })).toBeTruthy();
  });

  test("a 112 line raised by the last turn shows as the panel under the new question", async () => {
    renderPage(<DraftScreen page={page({ ...SAMPLE_DRAFTS.numberForm, notices: [LIFE] })} acted={null} />);
    expect(await screen.findByRole("link", { name: "Telepon 112" })).toBeTruthy();
    expect(screen.queryByText("Laporan dilanjutkan dari jawaban terakhir Anda.")).toBeNull();
  });

  test("with no notice nothing is added, and a refused post never shows the read's resume notices", async () => {
    renderPage(<DraftScreen page={page({ ...SAMPLE_DRAFTS.numberForm, notices: [] })} acted={null} />);
    await screen.findByRole("heading", { name: "Korban" });
    expect(screen.queryByRole("link", { name: "Telepon 112" })).toBeNull();
    renderPage(
      <DraftScreen
        page={page({ ...SAMPLE_DRAFTS.numberForm, notices: [LIFE, RESUMED] })}
        acted={{ envelope: null, posted: {}, networkLost: true }}
      />,
    );
    await screen.findByRole("heading", { name: "Korban" });
    expect(screen.queryByText("Laporan dilanjutkan dari jawaban terakhir Anda.")).toBeNull();
  });

  test("a 112 line from the read sits inside the live card, between its heading and its prompt", async () => {
    renderPage(<DraftScreen page={page({ ...SAMPLE_DRAFTS.choice, notices: [LIFE] })} acted={null} />);
    const call = await screen.findByRole("link", { name: "Telepon 112" });
    const card = call.closest("[data-card-kind]") as HTMLElement;
    expect(card.getAttribute("data-card-kind")).toBe("choice");
    const heading = screen.getByRole("heading", { name: "Jenis bencana" });
    const prompt = screen.getByText(ALL_TEXTS["card.choice.hazardType.prompt"] as string);
    expect(heading.compareDocumentPosition(call) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(call.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("the summary carries its own 112 panel, never two", async () => {
    renderPage(<DraftScreen page={page({ ...SAMPLE_DRAFTS.summary, notices: [LIFE] })} acted={null} />);
    await screen.findByRole("heading", { name: "Ringkasan laporan" });
    expect(screen.getAllByRole("link", { name: "Telepon 112" })).toHaveLength(1);
  });

  test("the danger warning sits inside the next card, under its question", async () => {
    const draft = { ...SAMPLE_DRAFTS.chronologyReview, notices: [notice("danger", "chronology.flood.step2.warning")] };
    renderDraft(<CardView card={draft.card} />, draft);
    const warning = await screen.findByText(ALL_TEXTS["chronology.flood.step2.warning"] as string);
    expect(warning.closest("[data-card-kind]")?.getAttribute("data-card-kind")).toBe("chronologyReview");
  });

  test("the live card's own line is not repeated as a bubble before it", async () => {
    renderPage(<DraftScreen page={page(withTranscript(SAMPLE_DRAFTS.numberForm))} acted={null} />);
    await screen.findByRole("heading", { name: "Korban" });
    expect(screen.getAllByText("Korban")).toHaveLength(1);
  });

  test("a history line is drawn from its question when it has one, else from its heading", async () => {
    const step = SAMPLE_DRAFTS.numberForm.card;
    const draft: DraftBody = {
      ...SAMPLE_DRAFTS.numberForm,
      transcript: [
        {
          speaker: "assistant",
          cardKind: "chronologyStep",
          copyKey: "card.chronologyStep.progress",
          promptKey: "chronology.flood.step1.question",
          params: { step: 1, total: 8 },
          at: SAMPLE_DRAFTS.chronologyStep.keptUntil,
        },
        {
          speaker: "assistant",
          cardKind: "choice",
          copyKey: "card.choice.hazardType.title",
          promptKey: null,
          params: {},
          at: SAMPLE_DRAFTS.chronologyStep.keptUntil,
        },
        { speaker: "reporter", textMasked: "Hujan deras", at: SAMPLE_DRAFTS.chronologyStep.keptUntil },
      ],
    };
    renderPage(<DraftScreen page={page(draft)} acted={null} />);
    expect(await screen.findByText(ALL_TEXTS["chronology.flood.step1.question"] as string)).toBeTruthy();
    expect(screen.queryByText("Cerita kejadian, langkah 1 dari 8.")).toBeNull();
    expect(screen.getByText("Jenis bencana")).toBeTruthy();
    expect(step.kind).toBe("numberForm");
  });

  test("nothing to undo is told as a refusal, not an error", async () => {
    const nothing: ErrorEnvelope = {
      error: { code: "draft.nothingToUndo", copyKey: "error.draft.nothingToUndo", params: {} },
      fields: [],
      retryAt: null,
      draft: null,
    };
    renderDraft(<CardView card={SAMPLE_DRAFTS.placeSearch.card} />, SAMPLE_DRAFTS.placeSearch, { envelope: nothing });
    await screen.findByText("Belum ada jawaban yang bisa dibatalkan.");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("hazard guesses", () => {
  test("guessed types come first and say so on their second line", async () => {
    const card = SAMPLE_DRAFTS.choice.card as Extract<Card, { kind: "choice" }>;
    const guessed = {
      ...card,
      options: card.options.map((option) => ({ ...option, guess: option.id === "earthquake" })),
    };
    renderDraft(<CardView card={guessed} />, { ...SAMPLE_DRAFTS.choice, card: guessed });
    const tiles = await screen.findAllByRole("button", { name: /Banjir|Tanah longsor|Gempa bumi/ });
    expect(tiles[0]?.textContent).toContain("Gempa bumi");
    expect(tiles[0]?.textContent).toContain("Sesuai cerita Anda");
    expect(tiles[1]?.textContent).not.toContain("Sesuai cerita Anda");
  });
});

const profile = SAMPLE_ME.knownReporters[0] as (typeof SAMPLE_ME.knownReporters)[number];
const known = {
  ...profile,
  openDraft: { ...(profile.openDraft as NonNullable<typeof profile.openDraft>), hazardType: "flood" },
};
const startPage = (extra: Partial<StartPageData> = {}): StartPageData => ({
  me: { ...SAMPLE_ME, knownReporters: [known] },
  view: "list",
  profileId: null,
  editing: false,
  emergency: false,
  texts: ALL_TEXTS,
  ...extra,
});
const acted = (extra: Partial<StartActionData>): StartActionData => ({
  view: "form",
  values: { role: "", name: "", number: "", officerRegency: "", officerPosition: "" },
  profileId: null,
  editing: false,
  readBack: null,
  envelope: null,
  removed: null,
  removeFailed: null,
  focusNumber: false,
  ...extra,
});

describe("the start step after review", () => {
  test("replacing an open draft after Ganti carries the changed name and role", async () => {
    const values = {
      role: "claimedOfficer",
      name: "Uji Baru",
      number: "",
      officerRegency: "Kabupaten Contoh",
      officerPosition: "Staf",
    };
    renderPage(
      <StartScreen
        page={startPage()}
        acted={acted({ view: "replaceConfirm", profileId: profile.profileId, editing: true, values })}
      />,
      {
        path: "/report",
        action: never,
      },
    );
    const accept = await screen.findByRole("button", { name: "Hapus dan buat baru" });
    const form = accept.closest("form") as HTMLFormElement;
    const sent = Object.fromEntries(new FormData(form));
    expect(sent).toMatchObject({
      profileId: profile.profileId,
      editProfile: "1",
      role: "claimedOfficer",
      name: "Uji Baru",
      officerRegency: "Kabupaten Contoh",
      officerPosition: "Staf",
    });
  });

  test("Ganti on the read-back returns with focus on the number", async () => {
    const values = { role: "citizen", name: "Uji Satu", number: "0800", officerRegency: "", officerPosition: "" };
    renderPage(
      <StartScreen page={startPage({ me: null, view: "form" })} acted={acted({ values, focusNumber: true })} />,
      { path: "/report" },
    );
    const number = await screen.findByLabelText("WhatsApp");
    await waitFor(() => expect(document.activeElement).toBe(number));
  });

  test("from the home's offer a new report asks first, then removes the old draft without starting one", async () => {
    renderPage(
      <StartScreen page={startPage({ view: "discardConfirm", profileId: profile.profileId })} acted={null} />,
      {
        path: "/report",
        action: never,
      },
    );
    expect(await screen.findByText(/Laporan yang belum selesai \(Banjir\)/)).toBeTruthy();
    const accept = screen.getByRole("button", { name: "Hapus dan buat baru" });
    const sent = Object.fromEntries(new FormData(accept.closest("form") as HTMLFormElement));
    expect(sent).toMatchObject({ draftId: known.openDraft.draftId });
    expect(accept.getAttribute("value")).toBe("discardOpenDraft");
    fireEvent.click(accept);
  });
});
