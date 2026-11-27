import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import { FEED_ALONE, FEED_ENTRY, OFFICIAL } from "../../testing/feed";
import { renderPage } from "../../testing/render";
import { FeedScreen, feedQuery, ringsOf } from "./FeedScreen";

vi.mock("./FeedMap", () => ({ FeedMap: () => <div data-testid="map" /> }));
// What this device follows, kept in memory for the test.
const kept = vi.hoisted(() => ({ follows: {} as Record<string, string> }));
vi.mock("../../lib/follow", () => ({
  followed: () => kept.follows,
  toggleFollow: (id: string, status: string) => {
    const { [id]: was, ...rest } = kept.follows;
    kept.follows = was === undefined ? { ...rest, [id]: status } : rest;
    return kept.follows;
  },
}));

describe("following an event on this device", () => {
  test("a followed event whose status moved on is marked; follow, let go, and show only those followed", async () => {
    kept.follows = { [FEED_ENTRY.id]: "in_handling" };
    renderPage(<FeedScreen load={{ kind: "feed", feed: { entries: [FEED_ENTRY, FEED_ALONE] } }} hazard={null} />, {
      path: "/feed",
    });
    const cards = () => screen.getAllByRole("article");
    const first = within((await screen.findAllByRole("article"))[0] as HTMLElement);
    expect(await first.findByText("Status berubah")).toBeTruthy();
    expect(first.getByRole("button", { name: "Diikuti" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(cards()[1] as HTMLElement).queryByText("Status berubah")).toBeNull();
    fireEvent.click(within(cards()[1] as HTMLElement).getByRole("button", { name: "Ikuti kejadian" }));
    expect(kept.follows).toEqual({ [FEED_ENTRY.id]: "in_handling", [FEED_ALONE.id]: FEED_ALONE.status });
    fireEvent.click(first.getByRole("button", { name: "Diikuti" }));
    const only = screen.getByRole("button", { name: "Hanya yang diikuti (1)" });
    fireEvent.click(only);
    expect(only.getAttribute("aria-pressed")).toBe("true");
    expect(cards()).toHaveLength(1);
    fireEvent.click(within(cards()[0] as HTMLElement).getByRole("button", { name: "Diikuti" }));
    expect(cards()).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^Hanya yang diikuti/ })).toBeNull();
  });
});

describe("the public feed page", () => {
  test("each event a card: its place, status, figures, times, how many reported and the photos of the work", async () => {
    renderPage(<FeedScreen load={{ kind: "feed", feed: { entries: [FEED_ENTRY, FEED_ALONE] } }} hazard={null} />, {
      path: "/feed",
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
    const photos = within(flood).getAllByRole("img", { name: /^Foto penanganan \d, Banjir di Desa\/Kel\. Uji Satu$/ });
    expect(photos[1]?.getAttribute("alt")).toBe("Foto penanganan 2, Banjir di Desa/Kel. Uji Satu");
    expect(photos.map((photo) => photo.getAttribute("src"))).toEqual(
      FEED_ENTRY.proofs.map((id) => `/api/feed/proofs/${id}`),
    );
    const quake = screen.getByRole("article", { name: "Gempa bumi" });
    expect(within(quake).getByText("Sedang ditangani")).toBeTruthy();
    expect(within(quake).getByText("Dampak belum didata")).toBeTruthy();
    expect(within(quake).queryByText(/^Kejadian/)).toBeNull();
    expect(within(quake).queryByText(/warga melaporkan/)).toBeNull();
    expect(within(quake).queryByRole("img")).toBeNull();
    const filter = screen.getByRole("navigation", { name: "Jenis bencana" });
    expect(within(filter).getByRole("link", { name: "Semua jenis" }).getAttribute("aria-current")).toBe("true");
    expect(within(filter).getByRole("link", { name: "Banjir" }).getAttribute("href")).toBe("/feed?hazard=flood");
  });

  test("the period and the hazard each keep the other in their links", async () => {
    renderPage(<FeedScreen load={{ kind: "feed", feed: { entries: [] } }} hazard="flood" period="3" />, {
      path: "/feed",
    });
    const periods = await screen.findByRole("navigation", { name: "Saring menurut waktu" });
    expect(within(periods).getByRole("link", { name: "3 hari" }).getAttribute("aria-current")).toBe("true");
    expect(within(periods).getByRole("link", { name: "Semua" }).getAttribute("href")).toBe("/feed?hazard=flood");
    expect(within(periods).getByRole("link", { name: "Hari terakhir" }).getAttribute("href")).toBe(
      "/feed?hazard=flood&period=latest",
    );
    const hazards = screen.getByRole("navigation", { name: "Jenis bencana" });
    expect(within(hazards).getAllByRole("link")[0]?.getAttribute("href")).toBe("/feed?period=3");
    expect(feedQuery(null, "all")).toBe("");
  });

  test("nothing handled yet: says why and leads to a report, or back to every hazard", async () => {
    const view = renderPage(<FeedScreen load={{ kind: "feed", feed: { entries: [] } }} hazard={null} />, {
      path: "/feed",
    });
    expect(await screen.findByRole("heading", { name: "Belum ada laporan yang ditangani" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lapor kejadian" }).getAttribute("href")).toBe("/report");
    expect(screen.queryByRole("link", { name: "Lihat semua jenis" })).toBeNull();
    view.unmount();
    renderPage(<FeedScreen load={{ kind: "feed", feed: { entries: [] } }} hazard="landslide" />, {
      path: "/feed",
    });
    expect(await screen.findByRole("heading", { name: "Belum ada laporan Tanah longsor yang ditangani" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lihat semua jenis" }).getAttribute("href")).toBe("/feed");
    expect(screen.getByRole("link", { name: "Tanah longsor" }).getAttribute("aria-current")).toBe("true");
  });

  test("a feed that cannot be read says so, with the limit's words when it is one", async () => {
    const view = renderPage(<FeedScreen load={{ kind: "unavailable", envelope: null }} hazard={null} />, {
      path: "/feed",
    });
    expect(await screen.findByRole("heading", { name: "Alun-alun belum bisa dimuat" })).toBeTruthy();
    expect(screen.getByText("Coba muat ulang halaman ini sebentar lagi.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Muat ulang" }).getAttribute("href")).toBe("/feed");
    view.unmount();
    const envelope: ErrorEnvelope = {
      error: { code: "limit.address.feed", copyKey: "limit.address.feed", params: { limit: 600 } },
      fields: [],
      retryAt: { utc: new Date(Date.now() + 20 * 60_000).toISOString(), zone: "WIB" },
      draft: null,
    };
    renderPage(<FeedScreen load={{ kind: "unavailable", envelope }} hazard={null} />, { path: "/feed" });
    expect(await screen.findByText(/^Alun-alun sudah dibuka 600 kali dalam satu jam/)).toBeTruthy();
  });
});

test("the map's rings hold the reports shown and BNPB's events whose province is known", () => {
  expect(ringsOf([FEED_ENTRY], OFFICIAL).map((ring) => [ring.provinceName, ring.total])).toEqual([["Aceh", 2]]);
  expect(ringsOf([FEED_ENTRY], null).map((ring) => ring.total)).toEqual([1]);
});
