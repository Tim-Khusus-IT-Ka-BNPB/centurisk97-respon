import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { envelope } from "../../../../src/api/envelope";
import type { Card } from "../../../../src/contract/card";
import type { DraftBody } from "../../../../src/contract/draft";
import { SAMPLE_DRAFTS } from "../../../../src/testing/samples";
import { never, renderDraft, renderPage } from "../../../testing/render";
import { CardView } from "../CardView";
import { DraftAside } from "../DraftAside";

type Summary = Extract<Card, { kind: "summary" }>;
const summary = SAMPLE_DRAFTS.summary.card as Summary;
const DEAD = { fieldId: "dead", state: "value", value: { kind: "count", count: 2 }, origin: "quote" } as const;

function news(followUp: Partial<NonNullable<Summary["followUp"]>> = {}, card: Partial<Summary> = {}): DraftBody {
  return {
    ...SAMPLE_DRAFTS.summary,
    followUpOf: "LA-231126-01",
    card: {
      ...summary,
      titleKey: "card.followUp.title",
      promptKey: "card.followUp.prompt",
      params: { ticketNumber: "LA-231126-01" },
      groups: [
        { groupId: "victims", rows: [DEAD, { fieldId: "missing", state: "notYetKnown", value: null, origin: null }] },
        {
          groupId: "specific",
          rows: [{ fieldId: "farmland", state: "none", value: null, origin: "tappedOption" }],
        },
        { groupId: "services", rows: [] },
      ],
      photos: { count: 0, withPlace: 0 },
      followUp: { ticketNumber: "LA-231126-01", hazardType: "flood", changes: [], mayAddPhotos: true, ...followUp },
      ...card,
    },
  };
}
const draw = (draft: DraftBody, options: Parameters<typeof renderDraft>[2] = {}) =>
  renderDraft(<CardView card={draft.card} />, draft, options);

describe("news for a sent report", () => {
  test("names its report, what it holds by part, and each part's own way to change it", async () => {
    draw(news());
    expect(await screen.findByRole("heading", { name: "Tambah kabar untuk LA-231126-01" })).toBeTruthy();
    expect(screen.getByText("Belum ada yang berubah.")).toBeTruthy();
    const parts = within(screen.getByRole("region", { name: "Bagian laporan" }));
    expect(parts.getByText("Meninggal 2 orang; Hilang belum didata")).toBeTruthy();
    // The hazard words the label, though the hazard itself may not be changed here.
    expect(parts.getByText("Sawah atau kebun terendam tidak ada")).toBeTruthy();
    expect(parts.getByText("belum diisi")).toBeTruthy();
    expect(parts.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Ubah",
      "Ubah",
      "Isi",
      "Tambah foto",
    ]);
    const photos = parts.getByRole("button", { name: "Tambah foto" }) as HTMLButtonElement;
    const sent = new FormData(photos.form as HTMLFormElement);
    expect([sent.get("kind"), sent.get("groupId")]).toEqual(["editGroup", "photos"]);
    expect(screen.getByRole("button", { name: "Batalkan kabar" })).toBeTruthy();
  });

  test("what would be sent stands first, with its photos, and sending it is told", async () => {
    draw(
      news(
        {
          changes: [{ fieldId: "dead", from: null, to: DEAD }],
          mayAddPhotos: false,
        },
        { photos: { count: 2, withPlace: 0 } },
      ),
      { action: never },
    );
    const sent = within(await screen.findByRole("region", { name: "Yang akan dikirim" }));
    expect(sent.getByRole("listitem").textContent).toBe("Meninggal: belum didata menjadi 2 orang");
    expect(sent.getByText("2 foto baru")).toBeTruthy();
    expect(sent.queryByText("Belum ada yang berubah.")).toBeNull();
    expect(screen.getByText("Laporan ini sudah punya foto paling banyak.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tambah foto" })).toBeNull();
    const button = sent.getByRole("button", { name: "Kirim kabar" }) as HTMLButtonElement;
    expect(new FormData(button.form as HTMLFormElement).get("action")).toBe("send");
    fireEvent.click(button);
    expect(await sent.findByRole("button", { name: "Mengirim kabar..." })).toBeTruthy();
  });

  test("a refused send says why beside its button", async () => {
    const view = draw(news(), { envelope: envelope("followUp.nothingNew") });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Belum ada yang berubah, jadi kabar belum dikirim.");
    view.unmount();
    draw(news(), { envelope: envelope("followUp.closed", { params: { reason: "followUp.closed.tooLate" } }) });
    expect((await screen.findByRole("alert")).textContent).toContain("sampai 72 jam sejak laporan");
  });

  test("once over it leads back to its report", async () => {
    const view = draw(SAMPLE_DRAFTS.followUpEnded);
    expect(await screen.findByRole("heading", { name: "Kabar terkirim" })).toBeTruthy();
    expect(screen.getByText("Kabar Anda masuk ke laporan LA-231126-01 sebagai versi baru.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Buka laporan" }).getAttribute("href")).toBe("/lapor/reports/LA-231126-01");
    view.unmount();
    const ended = SAMPLE_DRAFTS.followUpEnded.card as Extract<Card, { kind: "followUpEnded" }>;
    draw({
      ...SAMPLE_DRAFTS.followUpEnded,
      card: {
        ...ended,
        outcome: "cancelled",
        titleKey: "card.followUp.cancelled.title",
        promptKey: "card.followUp.cancelled.body",
      },
    });
    expect(await screen.findByText("Laporan LA-231126-01 tidak berubah.")).toBeTruthy();
  });

  test("its drop is confirmed in its own words, and the page beside it names the report", async () => {
    draw({
      ...news(),
      card: {
        ...(SAMPLE_DRAFTS.confirm.card as Extract<Card, { kind: "confirm" }>),
        titleKey: "card.confirm.cancelFollowUp.title",
        promptKey: "card.confirm.cancelFollowUp.body",
        params: { ticketNumber: "LA-231126-01" },
        confirmId: "cancelFollowUp",
      },
    });
    expect(
      await screen.findByText("Kabar yang belum dikirim akan dihapus. Laporan LA-231126-01 tidak berubah."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ya, batalkan kabar" })).toBeTruthy();
    renderPage(<DraftAside draft={news()} />);
    expect(await screen.findByRole("heading", { name: "Kabar untuk LA-231126-01" })).toBeTruthy();
    expect(screen.queryByText(/Lengkap/)).toBeNull();
    expect(screen.getByText(/^batal: membatalkan kabar/)).toBeTruthy();
  });
});
