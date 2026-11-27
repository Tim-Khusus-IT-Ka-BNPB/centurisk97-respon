import { screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import type { MapMarker } from "../../lib/deskMap";
import { TODAY } from "../../testing/feed";
import { renderPage } from "../../testing/render";
import { TodayScreen } from "./TodayScreen";

const drawn = vi.hoisted(() => ({ markers: [] as readonly MapMarker[], label: "" }));
vi.mock("./FeedMap", () => ({
  FeedMap: ({ markers, label }: { markers: readonly MapMarker[]; label: string }) => {
    drawn.markers = markers;
    drawn.label = label;
    return <div data-testid="map" />;
  },
}));

const draw = (load: Parameters<typeof TodayScreen>[0]["load"], hazard: string | null = null) =>
  renderPage(<TodayScreen load={load} hazard={hazard} />, { path: "/today" });

describe("the today page", () => {
  test("each event a card: its kind, place, checker, figures as ranges and how many reported", async () => {
    draw({ kind: "today", today: TODAY });
    const [flood, landslide] = (await screen.findAllByRole("article")) as [HTMLElement, HTMLElement];
    expect(within(flood).getByRole("heading").textContent).toBe("Banjir, Banjir bandang");
    expect(within(flood).getByText("Desa/Kel. Uji Satu, Kec. Baktiya, Aceh Utara, Aceh")).toBeTruthy();
    expect(within(flood).getByText(/^Diverifikasi BPBD Aceh Utara, /)).toBeTruthy();
    expect(
      within(flood)
        .getAllByRole("row")
        .map((row) => row.textContent),
    ).toEqual(["IsianMenurut laporan warga", "Meninggal2", "Mengungsi40 sampai 120"]);
    expect(within(flood).getByText("3 warga melapor")).toBeTruthy();
    expect(within(landslide).getByText(/^Diverifikasi BPBD Provinsi Sumatera Utara, /)).toBeTruthy();
    expect(within(landslide).getByText("Belum ada angka dampak dari laporan warga.")).toBeTruthy();
    expect(within(landslide).queryByText(/warga melapor/)).toBeNull();
    expect(screen.getByText("2 kejadian")).toBeTruthy();
    expect(drawn.label).toBe("today.map.label");
    expect(drawn.markers.map((marker) => [marker.anchor, marker.label])).toEqual([
      ["today-0123456789", "Banjir di Desa/Kel. Uji Satu"],
      ["today-abcdef0123", "Tanah longsor di Desa/Kel. Uji Dua"],
    ]);
    expect(screen.getByText("Cara membaca halaman ini")).toBeTruthy();
  });

  test("two kinds or more are filtered by links; a kind picked shows only its own", async () => {
    draw({ kind: "today", today: TODAY }, "landslide");
    const filter = await screen.findByRole("navigation", { name: "Saring menurut jenis kejadian" });
    expect(
      within(filter)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")]),
    ).toEqual([
      ["Semua", "/today", null],
      ["Banjir", "/today?hazard=flood", null],
      ["Tanah longsor", "/today?hazard=landslide", "true"],
    ]);
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  test("with none, says that is not no event, and leads to the Alun-alun; one kind has no filter", async () => {
    const view = draw({ kind: "today", today: { events: [] } });
    expect(
      await screen.findByRole("heading", { name: "Belum ada laporan terverifikasi dalam 24 jam terakhir" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lihat Alun-alun" }).getAttribute("href")).toBe("/feed");
    expect(screen.queryByRole("navigation", { name: "Saring menurut jenis kejadian" })).toBeNull();
    view.unmount();
    draw({ kind: "today", today: { events: [TODAY.events[0] as (typeof TODAY.events)[number]] } });
    expect(await screen.findAllByRole("article")).toHaveLength(1);
    expect(screen.queryByRole("navigation", { name: "Saring menurut jenis kejadian" })).toBeNull();
  });

  test("shut, it says so and leads home; unread, it says why and reloads", async () => {
    const view = draw({ kind: "closed" });
    expect(await screen.findByRole("heading", { name: "Halaman ini belum dibuka" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kembali ke beranda" }).getAttribute("href")).toBe("/");
    view.unmount();
    const limited: ErrorEnvelope = {
      error: { code: "limit.address.feed", copyKey: "limit.address.feed", params: { limit: 600 } },
      fields: [],
      retryAt: { utc: new Date(Date.now() + 20 * 60_000).toISOString(), zone: "WIB" },
      draft: null,
    };
    const second = draw({ kind: "unavailable", envelope: limited });
    expect(await screen.findByRole("heading", { name: "Kejadian hari ini belum bisa dimuat" })).toBeTruthy();
    expect(screen.getByText(/600/)).toBeTruthy();
    second.unmount();
    draw({ kind: "unavailable", envelope: null });
    expect((await screen.findByRole("link", { name: "Muat ulang" })).getAttribute("href")).toBe("/today");
  });
});
