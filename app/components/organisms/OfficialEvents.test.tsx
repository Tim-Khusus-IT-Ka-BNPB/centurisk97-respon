import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { FEED_ALONE, FEED_ENTRY, OFFICIAL } from "../../testing/feed";
import { renderPage } from "../../testing/render";
import { OfficialEvents } from "./OfficialEvents";

const draw = (props: Partial<Parameters<typeof OfficialEvents>[0]> = {}) =>
  renderPage(<OfficialEvents official={OFFICIAL} entries={[FEED_ENTRY, FEED_ALONE]} hazard={null} {...props} />, {
    path: "/feed",
  });

test("each event of BNPB's report with its status, figures, our own reports of it and its news", async () => {
  draw();
  // When upstream made the file, in WIB; a fresh one needs no note.
  expect(
    await screen.findByText(
      "Kejadian dalam laporan harian BNPB 26 Nov 2026, dengan berita yang ditemukan untuknya. Diperbarui 27 Nov 2026 pukul 07.53 WIB.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/lebih baru sejak itu/)).toBeNull();
  const cards = await screen.findAllByRole("listitem");
  const flood = within(cards[0] as HTMLElement);
  expect(flood.getByRole("heading", { level: 3 }).textContent).toBe("Banjir di Kabupaten Aceh Utara");
  expect(flood.getByText("Berlangsung")).toBeTruthy();
  expect(flood.getByText(/^Sejak 24 Nov 2026, laporan terakhir 26 Nov 2026\.$/)).toBeTruthy();
  expect(flood.getByText("120 KK terdampak")).toBeTruthy();
  expect(flood.getByText("45 rumah terdampak")).toBeTruthy();
  expect(flood.queryByText(/mengungsi/)).toBeNull();
  // Our own closed flood in Aceh Utara is of it.
  expect(flood.getByRole("link", { name: /laporan warga ditangani/ }).getAttribute("href")).toBe("/feed?hazard=flood");
  expect(flood.getByText("Berita (3)")).toBeTruthy();
  const news = flood.getByRole("link", { name: "Banjir Aceh Utara" });
  expect([news.getAttribute("href"), news.getAttribute("target"), news.getAttribute("rel")]).toEqual([
    "https://example.id/banjir",
    "_blank",
    "noopener noreferrer",
  ]);
  expect(flood.getByText("2 berita lain")).toBeTruthy();
  // Social media is not connected, so the card does not mention it.
  expect(flood.queryByText(/Media sosial/)).toBeNull();
  const slide = within(cards.find((card) => card.textContent?.includes("Bogor")) as HTMLElement);
  expect(slide.getByText("Selesai")).toBeTruthy();
  expect(slide.getByText("Angka dampak belum didata.")).toBeTruthy();
  expect(slide.getByText("Belum ada laporan warga yang ditangani untuk kejadian ini.")).toBeTruthy();
  expect(slide.getByText("Belum ada berita yang cocok.")).toBeTruthy();
});

test("a hazard picked shows only its events; none of it, or the report unread, says so", async () => {
  const view = draw({ hazard: "landslide" });
  expect((await screen.findAllByRole("heading", { level: 3 })).map((one) => one.textContent)).toEqual([
    "Tanah longsor di Bogor",
  ]);
  view.unmount();
  const none = draw({ hazard: "drought" });
  expect(await screen.findByText("Tidak ada kejadian jenis ini dalam laporan harian BNPB.")).toBeTruthy();
  none.unmount();
  draw({ official: null });
  expect(await screen.findByText("Laporan harian BNPB belum bisa dibaca.")).toBeTruthy();
  expect(screen.queryByRole("listitem")).toBeNull();
});

test("headlines all shown say no more", async () => {
  const [flood] = OFFICIAL.events;
  draw({ official: { ...OFFICIAL, events: [{ ...(flood as (typeof OFFICIAL.events)[number]), moreNews: 0 }] } });
  expect(await screen.findByText("Berita (1)")).toBeTruthy();
  expect(screen.queryByText(/berita lain/)).toBeNull();
});

test("a report made more than a day ago says no newer one has come", async () => {
  draw({ official: { ...OFFICIAL, stale: true } });
  expect(await screen.findByText("Belum ada laporan harian BNPB yang lebih baru sejak itu.")).toBeTruthy();
});
