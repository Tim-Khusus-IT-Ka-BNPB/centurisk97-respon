import { screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import { FEED_ALONE, FEED_ENTRY } from "../../testing/feed";
import { renderPage } from "../../testing/render";
import { FeedScreen } from "./FeedScreen";

vi.mock("./FeedMap", () => ({ FeedMap: () => <div data-testid="map" /> }));

describe("the public feed page", () => {
  test("each event a card: its place, status, figures, times, how many reported and the photos of the work", async () => {
    renderPage(<FeedScreen load={{ kind: "feed", feed: { entries: [FEED_ENTRY, FEED_ALONE] } }} hazard={null} />, {
      path: "/lapor/feed",
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Alun-alun" })).toBeTruthy();
    expect(screen.getByTestId("map")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "2 kejadian" })).toBeTruthy();
    const flood = screen.getByRole("article", { name: "Banjir, Banjir bandang" });
    expect(flood.id).toBe(`feed-${FEED_ENTRY.id}`);
    expect(within(flood).getByText("Desa/Kel. Uji Satu, Kec. Baktiya, Aceh Utara, Aceh")).toBeTruthy();
    expect(within(flood).getByText("Selesai ditangani")).toBeTruthy();
    expect(within(flood).getByText("meninggal")).toBeTruthy();
    expect(within(flood).getByText("Kejadian 24 Nov 2026, 08.30 WIB")).toBeTruthy();
    expect(within(flood).getByText("Dilaporkan 24 Nov 2026, 09.00 WIB")).toBeTruthy();
    expect(within(flood).getByText("3 warga melaporkan kejadian ini")).toBeTruthy();
    const photos = within(flood).getAllByRole("img", { name: "Foto penanganan Banjir di Desa/Kel. Uji Satu" });
    expect(photos.map((photo) => photo.getAttribute("src"))).toEqual(
      FEED_ENTRY.proofs.map((id) => `/api/lapor/feed/proofs/${id}`),
    );
    const quake = screen.getByRole("article", { name: "Gempa bumi" });
    expect(within(quake).getByText("Sedang ditangani")).toBeTruthy();
    expect(within(quake).getByText("Dampak belum didata")).toBeTruthy();
    expect(within(quake).queryByText(/^Kejadian/)).toBeNull();
    expect(within(quake).queryByText(/warga melaporkan/)).toBeNull();
    expect(within(quake).queryByRole("img")).toBeNull();
    const filter = screen.getByRole("navigation", { name: "Jenis bencana" });
    expect(within(filter).getByRole("link", { name: "Semua jenis" }).getAttribute("aria-current")).toBe("true");
    expect(within(filter).getByRole("link", { name: "Banjir" }).getAttribute("href")).toBe("/lapor/feed?hazard=flood");
  });

  test("nothing handled yet: says why and leads to a report, or back to every hazard", async () => {
    const view = renderPage(<FeedScreen load={{ kind: "feed", feed: { entries: [] } }} hazard={null} />, {
      path: "/lapor/feed",
    });
    expect(await screen.findByRole("heading", { name: "Belum ada laporan yang ditangani" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lapor kejadian" }).getAttribute("href")).toBe("/lapor/report");
    expect(screen.queryByRole("link", { name: "Lihat semua jenis" })).toBeNull();
    view.unmount();
    renderPage(<FeedScreen load={{ kind: "feed", feed: { entries: [] } }} hazard="landslide" />, {
      path: "/lapor/feed",
    });
    expect(await screen.findByRole("heading", { name: "Belum ada laporan Tanah longsor yang ditangani" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lihat semua jenis" }).getAttribute("href")).toBe("/lapor/feed");
    expect(screen.getByRole("link", { name: "Tanah longsor" }).getAttribute("aria-current")).toBe("true");
  });

  test("a feed that cannot be read says so, with the limit's words when it is one", async () => {
    const view = renderPage(<FeedScreen load={{ kind: "unavailable", envelope: null }} hazard={null} />, {
      path: "/lapor/feed",
    });
    expect(await screen.findByRole("heading", { name: "Alun-alun belum bisa dimuat" })).toBeTruthy();
    expect(screen.getByText("Coba muat ulang halaman ini sebentar lagi.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Muat ulang" }).getAttribute("href")).toBe("/lapor/feed");
    view.unmount();
    const envelope: ErrorEnvelope = {
      error: { code: "limit.address.feed", copyKey: "limit.address.feed", params: { limit: 600 } },
      fields: [],
      retryAt: { utc: new Date(Date.now() + 20 * 60_000).toISOString(), zone: "WIB" },
      draft: null,
    };
    renderPage(<FeedScreen load={{ kind: "unavailable", envelope }} hazard={null} />, { path: "/lapor/feed" });
    expect(await screen.findByText(/^Alun-alun sudah dibuka 600 kali dalam satu jam/)).toBeTruthy();
  });
});
