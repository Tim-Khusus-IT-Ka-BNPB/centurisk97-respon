import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Card } from "../../../../src/contract/card";
import type { DraftBody } from "../../../../src/contract/draft";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { SAMPLE_DRAFTS } from "../../../../src/testing/samples";
import { never, renderDraft } from "../../../testing/render";
import { CardView } from "../CardView";

type Sent = Extract<Card, { kind: "sent" }>;
const sent = SAMPLE_DRAFTS.sent.card as Sent;
const withCard = (card: Partial<Sent>): DraftBody => ({ ...SAMPLE_DRAFTS.sent, card: { ...sent, ...card } });
const draw = (draft: DraftBody, options: Parameters<typeof renderDraft>[2] = {}) =>
  renderDraft(<CardView card={draft.card} />, draft, options);

afterEach(() => vi.unstubAllGlobals());

describe("ticket card", () => {
  test("once rated: the number, the QR of the tracking link, the first stage done, tracking and the BPBD to call", async () => {
    draw(withCard({ rating: 4 }));
    const heading = await screen.findByRole("heading", { name: "Terima kasih, laporan Anda sudah kami terima" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByTestId("ticket-number").textContent).toBe("LA-231126-01");
    expect(screen.getByRole("img", { name: "Kode QR lacak laporan LA-231126-01" })).toBeTruthy();
    const strip = screen.getByRole("region", { name: "Tahap penanganan" });
    expect(
      within(strip)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Diterima",
      "Dilihat, Menunggu",
      "Ditelaah, Menunggu",
      "Ditindaklanjuti, Menunggu",
      "Selesai, Menunggu",
    ]);
    expect(screen.getByRole("link", { name: "Lacak laporan" }).getAttribute("href")).toBe(
      "/lapor/lacak#t=0123456789abcdef0123456789abcdef",
    );
    expect(screen.getByText("BPBD Aceh Utara")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Telepon 0800-1111-2222" }).getAttribute("href")).toBe("tel:080011112222");
    expect(screen.getByRole("link", { name: "Buat laporan baru" }).getAttribute("href")).toBe("/lapor/report");
    expect(document.querySelector('[data-card-kind="sent"]')?.getAttribute("data-card-id")).toBe("c-3");
    // Staff see the report and its number on the desk, so contact is promised (K18); nothing
    // that is not built yet is.
    expect(screen.getByText("Petugas kami akan menghubungi Anda bila perlu keterangan tambahan.")).toBeTruthy();
    expect(screen.queryByText(/PDF|Word|kabar|balasan|diteruskan/i)).toBeNull();
  });

  test("a province's BPBD, or BNPB's 117 when the area has no number", async () => {
    const tracking = sent.tracking;
    const { unmount } = draw(
      withCard({
        rating: 4,
        tracking: { ...tracking, contact: { level: "province", name: "Aceh", phone: "0800-1100-0001" } },
      }),
    );
    expect(await screen.findByText("BPBD Provinsi Aceh")).toBeTruthy();
    unmount();
    draw(withCard({ rating: 4, tracking: { ...tracking, contact: { level: "national" } } }));
    expect(await screen.findByText("Call Center BNPB 117")).toBeTruthy();
    expect(screen.getByText("Nomor BPBD daerah Anda belum tercatat.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Telepon 117" }).getAttribute("href")).toBe("tel:117");
  });

  test("Salin copies the number and says so", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    draw(withCard({ rating: 4 }));
    fireEvent.click(await screen.findByRole("button", { name: "Salin nomor tiket LA-231126-01" }));
    await screen.findByText("Tersalin");
    expect(writeText).toHaveBeenCalledWith("LA-231126-01");
  });

  test("Salin says it copied even when the browser refuses the clipboard, or has none", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: async () => Promise.reject(new Error("no")) } });
    const { unmount } = draw(withCard({ rating: 4 }));
    fireEvent.click(await screen.findByRole("button", { name: "Salin nomor tiket LA-231126-01" }));
    await screen.findByText("Tersalin");
    unmount();
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    draw(withCard({ rating: 4 }));
    fireEvent.click(await screen.findByRole("button", { name: "Salin nomor tiket LA-231126-01" }));
    await screen.findByText("Tersalin");
  });

  test("unrated: thanks by name with the number, a tap anywhere asks for the rating", async () => {
    draw(SAMPLE_DRAFTS.sent);
    const dialog = await screen.findByRole("alertdialog", { name: "Terima kasih, Uji!" });
    expect(within(dialog).getByText("LA-231126-01")).toBeTruthy();
    const next = within(dialog).getByRole("link", { name: /Ketuk di mana saja untuk lanjut/ });
    expect(next.getAttribute("href")).toBe("/lapor/report/d?rate");
    fireEvent.click(next);
    await screen.findByRole("alertdialog", { name: "Bagaimana pengalaman melapor Anda?" });
  });

  test("a rating posts the number and the choice, and a refused one says the allowed values", async () => {
    const posts: Record<string, FormDataEntryValue>[] = [];
    const action = async ({ request }: { request: Request }) => {
      posts.push(Object.fromEntries(await request.formData()));
      return never();
    };
    const { unmount } = draw(SAMPLE_DRAFTS.sent, { entry: "/lapor/report/d?rate", action });
    const choices = await screen.findAllByRole("button", { name: /^Nilai \d dari 5$/ });
    expect(choices).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Nilai 4 dari 5" }));
    await waitFor(() => expect(posts[0]).toMatchObject({ action: "rate", ticketNumber: "LA-231126-01", rating: "4" }));
    // A second tap while it is on its way sends nothing more.
    fireEvent.click(screen.getByRole("button", { name: "Nilai 4 dari 5" }));
    expect(posts).toHaveLength(1);
    unmount();
    const refused = {
      error: { code: "request.invalidFields", copyKey: "error.request.invalidFields", params: {} },
      fields: [{ fieldId: "rating", copyKey: "fieldError.rating.range", params: {} }],
      retryAt: null,
      draft: null,
    } as ErrorEnvelope;
    draw(SAMPLE_DRAFTS.sent, { entry: "/lapor/report/d?rate", envelope: refused });
    expect(await screen.findByText(/Nilai harus angka bulat 1 sampai 5/)).toBeTruthy();
  });
});
