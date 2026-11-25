import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { envelope } from "../../../src/api/envelope";
import { OWN_REPORT } from "../../testing/ownReport";
import { never, renderPage } from "../../testing/render";
import { OwnReportScreen } from "./OwnReportScreen";

type Version = (typeof OWN_REPORT.versions)[number];

const PATH = "/lapor/reports/LA-231126-01";
const draw = (report = OWN_REPORT, entry = PATH) =>
  renderPage(<OwnReportScreen report={report} />, { path: PATH, entry, action: never });

describe("the reporter's own report", () => {
  test("names the report, where it stands and how to reach it", async () => {
    draw();
    expect(await screen.findByRole("heading", { level: 1, name: "LA-231126-01" })).toBeTruthy();
    expect(screen.getByText("Banjir di Desa/Kel. Sukamaju")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Laporan saya" }).getAttribute("href")).toBe("/lapor#laporan-saya");
    const status = within(screen.getByRole("region", { name: "Status laporan" }));
    expect(status.getAllByRole("listitem")[0]?.textContent).toContain("Laporan diterima");
    expect(screen.getByRole("link", { name: "Buka halaman lacak" }).getAttribute("href")).toBe(
      "/lapor/lacak#t=0123456789abcdef0123456789abcdef",
    );
  });

  test("every version has its maker, what it changed and its two files, by plain links", async () => {
    draw();
    const documents = within(await screen.findByRole("region", { name: "Dokumen laporan" }));
    const [second, first] = documents.getAllByRole("listitem").filter((item) => item.textContent?.startsWith("Versi"));
    expect(second?.textContent).toContain(
      "Versi 2TerbaruKoreksi petugas di lapangan, 23 November 2026, pukul 12.00 WIB",
    );
    expect(second?.textContent).toContain("Meninggal: belum didata menjadi 2 orang");
    expect(second?.textContent).toContain("Hilang: belum didata menjadi tidak ada");
    expect(first?.textContent).toContain("Versi 1Laporan awal Anda, 23 November 2026, pukul 09.00 WIB");
    expect(first?.textContent).not.toContain("Terbaru");
    for (const [name, file] of [
      ["Unduh PDF versi 2", "v2.pdf"],
      ["Unduh Word versi 2", "v2.docx"],
      ["Unduh PDF versi 1", "v1.pdf"],
    ] as const)
      expect(documents.getByRole("link", { name }).getAttribute("href")).toBe(`${PATH}/${file}`);
  });

  test("with one version nothing is called newest; the reporter's own news is named as theirs", async () => {
    const [second, first] = OWN_REPORT.versions as [Version, Version];
    const view = draw({ ...OWN_REPORT, versions: [first] });
    await screen.findByText("Versi 1");
    expect(screen.queryByText("Terbaru")).toBeNull();
    view.unmount();
    draw({ ...OWN_REPORT, versions: [{ ...second, madeBy: "reporter" }, first] });
    expect(await screen.findByText(/Kabar tambahan Anda/)).toBeTruthy();
  });

  test("a refused download is told on the page", async () => {
    draw(OWN_REPORT, `${PATH}?refused=document`);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Dokumen belum bisa diunduh. Tunggu beberapa menit, lalu unduh lagi.",
    );
  });

  test("the photos of the work are read by this phone's own address", async () => {
    const proofs = [{ proofId: "p1", at: { utc: "2026-11-23T05:00:00.000Z", zone: "WIB" as const } }];
    draw({ ...OWN_REPORT, tracking: { ...OWN_REPORT.tracking, actions: ["Evakuasi warga"], proofs } });
    const photo = await screen.findByRole("img", { name: "Foto penanganan 1" });
    expect(photo.getAttribute("src")).toBe("/api/lapor/reports/LA-231126-01/proofs/p1");
  });

  test("news may be added until its time, by one button that says it is on the way", async () => {
    draw();
    const news = within(await screen.findByRole("region", { name: "Tambah kabar" }));
    expect(news.getByText(/sampai 26 November 2026, pukul 09.00 WIB/)).toBeTruthy();
    const button = news.getByRole("button", { name: "Tambah kabar" }) as HTMLButtonElement;
    expect([button.name, button.value]).toEqual(["action", "followUp"]);
    fireEvent.click(button);
    expect(await news.findByRole("button", { name: "Membuka..." })).toBeTruthy();
  });

  test.each([
    ["tooLate", "72 jam"],
    ["ended", "sudah ditutup petugas"],
    ["tooMany", "10 versi"],
  ] as const)("once closed it says why: %s", async (reason, words) => {
    draw({ ...OWN_REPORT, followUp: { state: "closed", reason } });
    const news = within(await screen.findByRole("region", { name: "Kabar tidak bisa ditambah lagi" }));
    expect(news.getByText(new RegExp(words))).toBeTruthy();
    expect(news.queryByRole("button")).toBeNull();
    expect(news.getByRole("link", { name: "Buat laporan baru" }).getAttribute("href")).toBe("/lapor/report");
  });

  test("a refused start says why, and leads to the report that must be finished first", async () => {
    const refused = (code: "followUp.finishFirst" | "followUp.closed", params: Record<string, string>) =>
      renderPage(<OwnReportScreen report={OWN_REPORT} envelope={envelope(code, { params })} />, {
        path: PATH,
        entry: `${PATH}?saved=sent`,
      });
    const view = refused("followUp.finishFirst", { draftId: "d-1" });
    expect((await screen.findByRole("alert")).textContent).toContain("Ada laporan yang belum selesai");
    expect(screen.getByRole("link", { name: "Buka laporan yang belum selesai" }).getAttribute("href")).toBe(
      "/lapor/report/d-1",
    );
    // What was saved before is not told again beside a refusal.
    expect(screen.queryByText(/Kabar terkirim/)).toBeNull();
    view.unmount();
    refused("followUp.closed", { reason: "followUp.closed.noProfile" });
    expect((await screen.findByRole("alert")).textContent).toContain("sudah dihapus dari perangkat ini");
    expect(screen.queryByRole("link", { name: "Buka laporan yang belum selesai" })).toBeNull();
  });

  test("news sent or dropped is told once, with the version it made", async () => {
    const view = draw(OWN_REPORT, `${PATH}?saved=sent`);
    expect((await screen.findByRole("status")).textContent).toBe("Kabar terkirim. Laporan ini sekarang versi 2.");
    view.unmount();
    draw(OWN_REPORT, `${PATH}?saved=cancelled`);
    expect((await screen.findByRole("status")).textContent).toBe("Kabar dibatalkan. Laporan ini tidak berubah.");
  });
});
