import { screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { DeskResponse } from "../../../../src/contract/desk";
import type { WarningControl } from "../../../../src/contract/warnings";
import { renderDesk, SUMMARY } from "../../../testing/desk";
import { DeskResponseView, monthStep } from "./DeskResponse";

const RESPONSE: DeskResponse = {
  account: { label: "Pusdalops BNPB, Petugas Uji" },
  month: "2026-11",
  agencies: [
    {
      regencyCode: "11.08",
      regencyName: "Aceh Utara",
      reports: 12,
      figures: {
        seen: { count: 10, median: 12, p90: 95 },
        taken: null,
        notSeen: 2,
        notTaken: 12,
        dropped: 0,
      },
    },
    {
      regencyCode: "12.07",
      regencyName: "Deli Serdang",
      reports: 6,
      figures: {
        seen: { count: 6, median: 5, p90: 8 },
        taken: { count: 6, median: 60, p90: 125 },
        notSeen: 0,
        notTaken: 0,
        dropped: 0,
      },
    },
    { regencyCode: "81.71", regencyName: "Kota Tual", reports: 3, figures: null },
  ],
};
const RUNNING: WarningControl = { open: true, paused: false, by: null, at: null, phones: 12 };
const draw = (response = RESPONSE, warnings: WarningControl | null = RUNNING, entry?: string) =>
  renderDesk(<DeskResponseView response={response} summary={SUMMARY} warnings={warnings} />, {
    path: "/desk/response",
    ...(entry ? { entry } : {}),
  });

describe("how fast each agency answers", () => {
  test("each agency's median and nine in ten, in minutes or hours, with what is still waiting", async () => {
    await draw();
    expect(screen.getByRole("heading", { level: 1, name: "Respons BPBD" })).toBeTruthy();
    const [aceh, deli, tual] = within(screen.getByRole("table")).getAllByRole("row").slice(1) as HTMLElement[];
    const first = within(aceh as HTMLElement);
    expect(first.getByRole("rowheader").textContent).toBe("BPBD Aceh Utara");
    expect(first.getByText("12 menit")).toBeTruthy();
    expect(first.getByText("9 dari 10 dalam 1 jam 35 menit")).toBeTruthy();
    expect(first.getByText("2 laporan belum")).toBeTruthy();
    expect(first.getByText("Belum ada")).toBeTruthy();
    const second = within(deli as HTMLElement);
    expect(second.getByText("1 jam 0 menit")).toBeTruthy();
    expect(second.queryByText(/laporan belum/)).toBeNull();
    expect(within(tual as HTMLElement).getByText("Belum cukup data, kurang dari 5 laporan.")).toBeTruthy();
  });

  test("leads to the months around it, and says when a month has no report", async () => {
    await draw({ ...RESPONSE, agencies: [] });
    expect(screen.getByText("November 2026")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Bulan sebelumnya" }).getAttribute("href")).toBe(
      "/desk/response?month=2026-10",
    );
    expect(screen.getByRole("link", { name: "Bulan berikutnya" }).getAttribute("href")).toBe(
      "/desk/response?month=2026-12",
    );
    expect(screen.getByText("Belum ada laporan di bulan ini.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    const door = screen.getAllByRole("link", { name: "Respons BPBD" })[0];
    expect([door?.getAttribute("href"), door?.getAttribute("aria-current")]).toEqual(["/desk/response", "page"]);
  });

  test("the weekly counts are posted for as a file, and a refused download says why", async () => {
    const view = await draw();
    const section = screen.getByRole("region", { name: "Data agregat untuk penelitian" });
    expect(within(section).getByText(/^Jumlah laporan per minggu/)).toBeTruthy();
    const button = within(section).getByRole("button", { name: "Unduh CSV" });
    const form = button.closest("form") as HTMLFormElement;
    expect([form.method, form.getAttribute("action")]).toEqual(["post", "/desk/response/aggregates"]);
    expect(within(section).queryByText(/belum bisa diunduh/)).toBeNull();
    view.unmount();
    await draw(RESPONSE, RUNNING, "/desk/response?refused=aggregates");
    expect(screen.getByText(/^Berkas belum bisa diunduh/)).toBeTruthy();
  });

  test("warnings run, are paused by an officer, or are shut, and the button posts the other way", async () => {
    const view = await draw();
    const section = () => within(screen.getByRole("region", { name: "Peringatan ke ponsel warga" }));
    expect(section().getByText(/^Peringatan berjalan: .* 12 ponsel berlangganan\.$/)).toBeTruthy();
    const pause = section().getByRole("button", { name: "Jeda peringatan" });
    const form = pause.closest("form") as HTMLFormElement;
    expect([form.method, (form.elements.namedItem("paused") as HTMLInputElement).value]).toEqual(["post", "1"]);
    view.unmount();
    const paused = await draw(RESPONSE, {
      ...RUNNING,
      paused: true,
      by: "Petugas Uji",
      at: "2026-11-26T03:05:00.000Z",
    });
    expect(
      section().getByText(/^Peringatan dijeda oleh Petugas Uji pada 26 November 2026 pukul 10\.05 WIB\./),
    ).toBeTruthy();
    const resume = section().getByRole("button", { name: "Jalankan lagi" });
    expect(((resume.closest("form") as HTMLFormElement).elements.namedItem("paused") as HTMLInputElement).value).toBe(
      "0",
    );
    paused.unmount();
    const shut = await draw(RESPONSE, { ...RUNNING, open: false, phones: 0 }, "/desk/response?refused=warnings");
    expect(section().getByText(/^Peringatan belum dibuka/)).toBeTruthy();
    expect(section().getByText(/^Belum tersimpan/)).toBeTruthy();
    expect(section().queryByRole("button")).toBeNull();
    shut.unmount();
    await draw(RESPONSE, null);
    expect(section().getByText(/^Keadaan peringatan belum bisa dibaca/)).toBeTruthy();
    expect(section().queryByRole("button")).toBeNull();
  });

  test("months step over the year's end", () => {
    expect(monthStep("2026-12", 1)).toBe("2027-01");
    expect(monthStep("2026-01", -1)).toBe("2025-12");
  });
});
