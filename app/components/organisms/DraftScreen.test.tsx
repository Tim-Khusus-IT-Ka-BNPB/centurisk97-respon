import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { DraftBody } from "../../../src/contract/draft";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import { SAMPLE_DRAFTS, SAMPLE_STALE_TURN } from "../../../src/testing/samples";
import type { DraftActionData, DraftPageData } from "../../lib/draftTypes";
import { ALL_TEXTS, never, renderPage } from "../../testing/render";
import { Page } from "../templates/Page";
import { lineKeys } from "./ChatLog";
import { DraftScreen, RefusedScreen } from "./DraftScreen";

afterEach(() => vi.useRealTimers());

const page = (draft: DraftBody, extra: Partial<Extract<DraftPageData, { kind: "draft" }>> = {}) =>
  ({ kind: "draft", draft, envelope: null, turnKey: "k-1", searching: false, texts: ALL_TEXTS, ...extra }) as Extract<
    DraftPageData,
    { kind: "draft" }
  >;
const reporterLine = {
  speaker: "reporter" as const,
  textMasked: "[nama pelapor] melihat air",
  at: SAMPLE_DRAFTS.numberForm.keptUntil,
};
const limit: ErrorEnvelope = {
  error: { code: "limit.message.minute", copyKey: "limit.message.minute", params: { limit: 20 } },
  fields: [],
  retryAt: { utc: new Date(Date.now() + 60_000).toISOString(), zone: "WIB" },
  draft: SAMPLE_DRAFTS.numberForm,
};

describe("the draft page", () => {
  test("a fresh draft opens with the 112 line, the live card, the box, a silent log and one status", async () => {
    const fresh = SAMPLE_DRAFTS.placeSearch;
    renderPage(<DraftScreen page={page(fresh)} acted={null} />);
    const log = await screen.findByRole("log");
    expect(log.getAttribute("aria-live")).toBe("off");
    expect(screen.getByRole("link", { name: "Telepon 112" }).getAttribute("href")).toBe("tel:112");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Lapor kejadian");
    expect(screen.getByRole("textbox", { name: "Pesan" }).getAttribute("name")).toBe("text");
    expect(screen.queryByText("Laporan dilanjutkan dari jawaban terakhir Anda.")).toBeNull();
  });

  test("news for a sent report has its own heading and no progress, and says it is news when resumed", async () => {
    const news = {
      ...SAMPLE_DRAFTS.numberForm,
      followUpOf: "LA-231126-01",
      notices: [{ kind: "resumed" as const, copyKey: "notice.resumed", params: {}, retryAt: null }],
    };
    renderPage(<DraftScreen page={page(news)} acted={null} />);
    expect(await screen.findByText("Kabar dilanjutkan dari jawaban terakhir Anda.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Tambah kabar");
    expect(screen.queryByText(/persen/)).toBeNull();
    expect(screen.queryByText(/Laporan ini disimpan/)).toBeNull();
  });

  test("a resumed draft shows its history, the resumed notice with kept-until and the 112 line, and announces nothing", async () => {
    const resumed = {
      ...SAMPLE_DRAFTS.numberForm,
      notices: [
        { kind: "lifeLine" as const, copyKey: "notice.lifeLine", params: {}, retryAt: null },
        { kind: "resumed" as const, copyKey: "notice.resumed", params: {}, retryAt: null },
      ],
    };
    renderPage(<DraftScreen page={page(resumed)} acted={null} />);
    expect(await screen.findByText("Laporan dilanjutkan dari jawaban terakhir Anda.")).toBeTruthy();
    // Once in the resumed notice, once in the wide-screen progress panel.
    expect(screen.getAllByText(/disimpan sampai/)).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Telepon 112" })).toBeTruthy();
    expect(screen.getByText("air masuk rumah [nama pelapor]")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  test("between steps, with no notice from the read, the 112 line is not repeated", async () => {
    const midway = { ...SAMPLE_DRAFTS.numberForm, transcript: [...SAMPLE_DRAFTS.numberForm.transcript, reporterLine] };
    renderPage(
      <DraftScreen
        page={page({
          ...midway,
          notices: [],
        })}
        acted={null}
      />,
    );
    await screen.findByRole("log");
    expect(screen.queryByRole("link", { name: "Telepon 112" })).toBeNull();
  });

  test("a stale tab is redrawn from the current draft in the refusal, with the notice", async () => {
    const acted: DraftActionData = { envelope: SAMPLE_STALE_TURN, posted: { text: ["air naik"] }, networkLost: false };
    renderPage(<DraftScreen page={page(SAMPLE_DRAFTS.placeSearch)} acted={acted} />);
    expect((await screen.findByRole("alert")).textContent).toContain("sudah berubah");
    expect(document.querySelector("[data-card-kind]")?.getAttribute("data-card-kind")).toBe("numberForm");
    expect((screen.getByRole("textbox", { name: "Pesan" }) as HTMLTextAreaElement).value).toBe("air naik");
  });

  test("a limit keeps the box open with the text, names the retry time and holds sending until then", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const acted: DraftActionData = { envelope: limit, posted: { text: ["tolong"] }, networkLost: false };
    renderPage(<DraftScreen page={page(SAMPLE_DRAFTS.numberForm)} acted={acted} />, { action: never });
    const send = await screen.findByRole("button", { name: "Kirim pesan" });
    expect(send.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getAllByText(/20 pesan per menit/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Telepon 112" }).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("20 pesan per menit"));
    fireEvent.click(send);
    expect(send.textContent).not.toContain("Sedang mencatat");
    act(() => vi.advanceTimersByTime(61_000));
    await waitFor(() => expect(send.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(send);
    await waitFor(() => expect(send.textContent).toBe("Sedang mencatat..."));
  });

  test("a message too long is refused under the box, with the text kept and focus in the box", async () => {
    const tooLong: ErrorEnvelope = {
      error: { code: "request.invalidFields", copyKey: "error.request.invalidFields", params: {} },
      fields: [{ fieldId: "text", copyKey: "fieldError.message.tooLong", params: { length: 2001 } }],
      retryAt: null,
      draft: null,
    };
    const typed = "a".repeat(2001);
    renderPage(
      <DraftScreen
        page={page(SAMPLE_DRAFTS.numberForm)}
        acted={{ envelope: tooLong, posted: { text: [typed] }, networkLost: false }}
      />,
    );
    const box = (await screen.findByRole("textbox", { name: "Pesan" })) as HTMLTextAreaElement;
    expect(box.value).toHaveLength(2001);
    expect(box.getAttribute("aria-describedby")).toContain("text-error");
    expect(document.activeElement).toBe(box);
    expect(screen.getByText("2.001 dari 2.000 huruf")).toBeTruthy();
  });

  test("a sent draft has no box and no resumed notice", async () => {
    renderPage(
      <DraftScreen
        page={page({
          ...SAMPLE_DRAFTS.sent,
          notices: [{ kind: "resumed", copyKey: "notice.resumed", params: {}, retryAt: null }],
        })}
        acted={null}
      />,
    );
    await screen.findByTestId("ticket-number");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("Laporan dilanjutkan dari jawaban terakhir Anda.")).toBeNull();
  });

  test("a cancelled draft has no history, no box, and a free-text card offers no hint", async () => {
    renderPage(<DraftScreen page={page(SAMPLE_DRAFTS.cancelled)} acted={null} />);
    expect(await screen.findByRole("heading", { name: "Laporan dibatalkan" })).toBeTruthy();
    expect(screen.queryByRole("log")).toBeNull();
    renderPage(<DraftScreen page={page({ ...SAMPLE_DRAFTS.numberForm, freeTextAllowed: true })} acted={null} />);
    await screen.findByRole("textbox", { name: "Pesan" });
    expect(screen.queryByText(/Pilih jawaban di kartu di atas/)).toBeNull();
  });

  test("the box says to use the card when free text is not taken", async () => {
    renderPage(<DraftScreen page={page({ ...SAMPLE_DRAFTS.numberForm, freeTextAllowed: false })} acted={null} />);
    expect(await screen.findByText(/Pilih jawaban di kartu di atas/)).toBeTruthy();
  });

  test("lines that share a time and speaker still get their own key", () => {
    expect(lineKeys([reporterLine, reporterLine])).toEqual([
      `${reporterLine.at.utc}:reporter:0`,
      `${reporterLine.at.utc}:reporter:1`,
    ]);
  });
});

describe("a draft that cannot be opened", () => {
  const refused = (code: string, copyKey: string, retryAt: ErrorEnvelope["retryAt"] = null) =>
    ({ error: { code, copyKey, params: { limit: 2000 } }, fields: [], retryAt, draft: null }) as ErrorEnvelope;
  const draw = (envelope: ErrorEnvelope) =>
    renderPage(
      <Page texts={ALL_TEXTS} publicPage={false}>
        <RefusedScreen envelope={envelope} />
      </Page>,
    );

  test("an owner's expired draft says so and offers a new one", async () => {
    draw(refused("draft.expired", "card.expired.body"));
    expect(await screen.findByRole("heading", { level: 1, name: "Laporan sudah kedaluwarsa" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Buat laporan baru" })).toBeTruthy();
  });

  test("no reporter yet: sign in first, with the way forward", async () => {
    draw(refused("auth.signInFirst", "error.auth.signInFirst"));
    expect(await screen.findByRole("heading", { level: 1, name: "Masuk dulu dengan nomor HP Anda." })).toBeTruthy();
    expect(screen.getByText(/Buka laporan dari perangkat/)).toBeTruthy();
  });

  test("not found, and a read limit, are named as they are", async () => {
    draw(refused("draft.notFound", "error.draft.notFound"));
    expect(await screen.findByRole("heading", { level: 1, name: "Laporan tidak ditemukan" })).toBeTruthy();
    expect(screen.getByText(/^Laporan ini tidak ada atau tidak bisa dibuka/).tagName).toBe("P");
    draw(refused("request.refused", "error.request.refused"));
    expect(await screen.findByRole("heading", { level: 1, name: /Halaman ini tidak bisa mengirim/ })).toBeTruthy();
    draw(
      refused("limit.address.draftReads", "limit.address.draftReads", { utc: "2026-11-23T03:00:00.000Z", zone: "WIB" }),
    );
    expect(await screen.findByRole("heading", { level: 1, name: /pembukaan laporan/ })).toBeTruthy();
  });
});
