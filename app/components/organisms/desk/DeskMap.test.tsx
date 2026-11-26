import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { FILTERS, ITEM, queue, renderDesk, SUMMARY } from "../../../testing/desk";

const canvas = vi.hoisted(() => ({
  pointed: null as string | null,
  view: (_tickets: ReadonlySet<string>) => {},
}));
vi.mock("../DeskMapCanvas", () => ({
  DeskMapCanvas: (props: { label: string; pointed: string | null; onView: (tickets: ReadonlySet<string>) => void }) => {
    canvas.pointed = props.pointed;
    canvas.view = props.onView;
    return <section aria-label={props.label} />;
  },
}));

import { DeskMapView } from "./DeskMap";

const MAP = { ...FILTERS, view: "map" as const };
const POINT = {
  ticketNumber: "LA-241126-01",
  status: "seen" as const,
  hazardType: "flood" as const,
  villageName: "Sukamaju",
  precision: "villageLevel" as const,
  emergency: false,
  lat: 5.1,
  lon: 97.123456,
};
const POINTS = [POINT, { ...POINT, ticketNumber: "LA-241126-02", lat: -8 }];
const map = (points = POINTS, cut = false) => ({ account: { label: "Petugas" }, points, cut });
const draw = (props: Partial<Parameters<typeof DeskMapView>[0]> = {}) =>
  renderDesk(<DeskMapView map={map()} queue={queue()} summary={SUMMARY} filters={MAP} envelope={null} {...props} />, {
    path: "/lapor/meja",
  });
const panel = () => within(screen.getByRole("region", { name: "Laporan di peta" }));
const tickets = () =>
  panel()
    .getAllByRole("link", { name: /LA-2411/ })
    .map((link) => link.getAttribute("href"));

beforeEach(() => {
  canvas.pointed = null;
});

describe("the map view", () => {
  test("the map with its filters and legend, and beside it each report with its figures", async () => {
    await draw();
    expect(screen.getByRole("heading", { level: 1, name: "Peta laporan" })).toBeTruthy();
    expect(screen.getByText("Belum ditangani")).toBeTruthy();
    expect(panel().getByText("2 laporan")).toBeTruthy();
    const first = within(panel().getAllByRole("listitem")[0] as HTMLElement);
    expect(first.getByRole("link").getAttribute("href")).toBe("/lapor/meja/LA-241126-01");
    expect(first.getByText("Banjir, Sukamaju, Aceh Utara")).toBeTruthy();
    expect(first.getByText("24 Nov 2026, 09.30 WIB")).toBeTruthy();
    // Only figures above zero: two dead and at least three houses, but not "0 luka-luka".
    expect(first.getByRole("link").textContent).toContain("2 meninggal3+ rumah rusak");
    expect(first.queryByText(/luka-luka/)).toBeNull();
    expect(first.getByText("2 foto")).toBeTruthy();
    expect(panel().queryByText(/di area peta ini/)).toBeNull();
  });

  test("an emergency is marked", async () => {
    const emergency = { kind: "oneTap" as const, victims: "unknown" as const };
    await draw({ queue: queue({ items: [{ ...ITEM, hazardType: "other", emergency }], total: 1 }) });
    const row = within(panel().getAllByRole("listitem")[0] as HTMLElement);
    expect(row.getByText("Darurat")).toBeTruthy();
    expect(row.getByText("Jenis belum diketahui, Sukamaju, Aceh Utara")).toBeTruthy();
  });

  test("a report sent late from a phone with no signal is marked late, not as an emergency", async () => {
    const emergency = { kind: "oneTap" as const, victims: "yes" as const };
    await draw({ queue: queue({ items: [{ ...ITEM, emergency, offline: { savedAt: null, late: true } }], total: 1 }) });
    const row = within(panel().getAllByRole("listitem")[0] as HTMLElement);
    expect(row.getByText("Dikirim terlambat")).toBeTruthy();
    expect(row.queryByText("Darurat")).toBeNull();
  });

  test("news no officer has acted on is marked, and so is a week in one status", async () => {
    await draw({ queue: queue({ items: [{ ...ITEM, news: true, overdue: true }], total: 1 }) });
    const row = within(panel().getAllByRole("listitem")[0] as HTMLElement);
    expect(row.getByText("Kabar baru")).toBeTruthy();
    expect(row.getByText("Lewat seminggu")).toBeTruthy();
  });

  test("a report with no figures and no photo shows none", async () => {
    const impact = { dead: 0, missing: null, injured: 0, displaced: 0, houses: null };
    await draw({ queue: queue({ items: [{ ...ITEM, photoCount: 0, impact }], total: 1 }) });
    const row = within(panel().getAllByRole("listitem")[0] as HTMLElement);
    expect(row.queryByText(/foto/)).toBeNull();
    expect(row.queryByText(/Rumah rusak/)).toBeNull();
  });

  test("the list follows the map; a report with no point on it is always listed", async () => {
    await draw({
      queue: queue({ items: [...queue().items, { ...ITEM, ticketNumber: "LA-241126-03" }], total: 3 }),
    });
    expect(new Set(tickets()).size).toBe(3);
    act(() => canvas.view(new Set(["LA-241126-02"])));
    expect(panel().getByRole("status").textContent).toBe("2 di area peta ini");
    const rows = panel().getAllByRole("listitem").slice(0, 2);
    expect(rows.map((row) => within(row).getByRole("link").getAttribute("href"))).toEqual([
      "/lapor/meja/LA-241126-02",
      "/lapor/meja/LA-241126-03",
    ]);
  });

  test("a map moved away from every report says so", async () => {
    await draw();
    act(() => canvas.view(new Set()));
    expect(panel().getByText(/Tidak ada laporan di area peta ini/)).toBeTruthy();
  });

  test("pointing at a report, by mouse or by focus, marks it on the map", async () => {
    await draw();
    const row = panel().getAllByRole("listitem")[1] as HTMLElement;
    fireEvent.mouseEnter(row);
    expect(canvas.pointed).toBe("LA-241126-02");
    fireEvent.mouseLeave(row);
    expect(canvas.pointed).toBeNull();
    fireEvent.focus(row);
    expect(canvas.pointed).toBe("LA-241126-02");
    fireEvent.blur(row);
    expect(canvas.pointed).toBeNull();
  });

  test("its figures are filters, with or without their counts", async () => {
    const view = await draw({ filters: { ...MAP, status: "seen" } });
    expect(panel().getByText("Antrean Dilihat")).toBeTruthy();
    expect(panel().getByRole("link", { name: "Ada rumah rusak, 5 laporan" }).getAttribute("href")).toBe(
      "/lapor/meja?status=seen&has=houses",
    );
    expect(screen.getByRole("link", { name: "Hapus saringan" }).getAttribute("href")).toBe("/lapor/meja");
    view.unmount();
    await draw({ summary: null });
    expect(panel().getByRole("link", { name: "Ada rumah rusak" })).toBeTruthy();
  });

  test("with a filter on and nothing to show, it says the filter is why", async () => {
    await draw({
      map: map([]),
      queue: queue({ items: [], total: 0, pageCount: 0 }),
      filters: { ...MAP, status: "seen" },
    });
    expect(panel().getByText(/Tidak ada laporan yang cocok dengan saringan ini/)).toBeTruthy();
  });

  test("with nothing to show the map stays and says so", async () => {
    await draw({ map: map([]), queue: queue({ items: [], total: 0, pageCount: 0 }) });
    expect(screen.getByRole("region", { name: "Peta laporan" })).toBeTruthy();
    expect(panel().getByText("Belum ada laporan masuk. Laporan baru tampil di sini.")).toBeTruthy();
    expect(panel().queryByText(/Daftar titik/)).toBeNull();
  });

  test("more than a page leads to the full list, and a cut map says how many it draws", async () => {
    await draw({
      map: map(POINTS, true),
      queue: queue({ total: 120, pageCount: 3 }),
      filters: { ...MAP, has: "photos" },
    });
    expect(panel().getByText("Menampilkan 2 laporan terbaru.")).toBeTruthy();
    expect(panel().getByRole("link", { name: "Buka daftar lengkap" }).getAttribute("href")).toBe(
      "/lapor/meja?view=list&has=photos",
    );
    expect(panel().getByText(/Peta menampilkan 2 laporan terbaru/)).toBeTruthy();
  });

  test("every point is listed with its place for a page with no script", async () => {
    await draw();
    expect(panel().getByText("Daftar titik (2)")).toBeTruthy();
    expect(panel().getAllByText("Banjir, Dilihat, Sukamaju")).toHaveLength(2);
    expect(panel().getByText("5.100000, 97.123456, perkiraan tingkat desa")).toBeTruthy();
  });
});
