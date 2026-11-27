import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { NewsItem, OwnReportDetail } from "../../../src/contract/ownReport";
import { OWN_REPORT } from "../../testing/ownReport";
import { never, renderPage } from "../../testing/render";
import { OwnNews } from "./OwnNews";

const PATH = "/reports/LA-231126-01";
const at = (hour: number) => ({ utc: `2026-11-23T0${hour}:00:00.000Z`, zone: "WIB" as const });
const ITEMS: NewsItem[] = [
  { kind: "status", at: at(6), isNew: true, status: "invalid", reason: "Laporan ganda" },
  { kind: "reply", at: at(5), isNew: true, text: "Terima kasih,\nkami cek" },
  { kind: "actions", at: at(4), isNew: false, actions: ["Evakuasi warga", "Dapur umum"] },
  {
    kind: "correction",
    at: at(3),
    isNew: false,
    version: 2,
    changes: OWN_REPORT.versions[0]?.changes as OwnReportDetail["versions"][number]["changes"],
  },
  { kind: "status", at: at(2), isNew: false, status: "seen", reason: null },
];
const withNews = (news: Partial<OwnReportDetail["news"]>): OwnReportDetail => ({
  ...OWN_REPORT,
  news: { stopped: false, items: ITEMS, ...news },
});

function draw(report: OwnReportDetail) {
  const posted: string[] = [];
  const view = renderPage(<OwnNews report={report} />, {
    path: PATH,
    action: async ({ request }) => {
      posted.push(String((await request.formData()).get("action")));
      return null;
    },
  });
  return { ...view, posted };
}

describe("news of one's own report", () => {
  test("each item in the reporter's words, the newest first, what is new marked and counted", async () => {
    const { posted } = draw(withNews({}));
    const news = within(await screen.findByRole("region", { name: /Kabar petugas/ }));
    expect(news.getByRole("heading").textContent).toBe("Kabar petugas2 baru");
    const list = news.getAllByRole("list")[0] as HTMLElement;
    const items = [...list.children].map((item) => item.textContent);
    expect(items).toEqual([
      "Tidak dapat ditindaklanjutiBaru23 November 2026, pukul 13.00 WIBAlasan petugas: Laporan ganda",
      "Balasan petugasBaru23 November 2026, pukul 12.00 WIBTerima kasih,\nkami cek",
      "Tindakan petugas23 November 2026, pukul 11.00 WIBEvakuasi wargaDapur umum",
      expect.stringContaining("Koreksi petugas di lapangan23 November 2026, pukul 10.00 WIBMeninggal: belum didata"),
      "Sudah dilihat petugas23 November 2026, pukul 09.00 WIB",
    ]);
    // It is read by being drawn, once.
    await waitFor(() => expect(posted).toEqual(["newsRead"]));
  });

  test("with nothing new nothing is posted, and with no news it says what will come", async () => {
    const { posted, unmount } = draw(withNews({ items: ITEMS.slice(2) }));
    expect((await screen.findByRole("heading", { level: 2 })).textContent).toBe("Kabar petugas");
    unmount();
    draw(withNews({ items: [] }));
    expect(await screen.findByText(/^Belum ada kabar\./)).toBeTruthy();
    expect(posted).toEqual([]);
  });

  test("it can be stopped and started, each saying what stays and that it is on the way", async () => {
    const view = renderPage(<OwnNews report={withNews({ items: [] })} />, { path: PATH, action: never });
    expect(await screen.findByText("Kabar baru ditandai di daftar Laporan saya.")).toBeTruthy();
    const stop = screen.getByRole("button", { name: "Hentikan kabar" }) as HTMLButtonElement;
    expect([stop.name, stop.value]).toEqual(["action", "newsStop"]);
    fireEvent.click(stop);
    expect(await screen.findByRole("button", { name: "Menyimpan..." })).toBeTruthy();
    view.unmount();
    renderPage(<OwnNews report={withNews({ items: [], stopped: true })} />, { path: PATH });
    expect(await screen.findByText(/Status dan balasan tetap bisa dibaca di sini/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Nyalakan kabar" }) as HTMLButtonElement).value).toBe("newsStart");
  });
});
