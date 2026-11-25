import { screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { DeskResponse } from "../../../../src/contract/desk";
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
const draw = (response = RESPONSE) =>
  renderDesk(<DeskResponseView response={response} summary={SUMMARY} />, { path: "/lapor/meja/respons" });

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
      "/lapor/meja/respons?month=2026-10",
    );
    expect(screen.getByRole("link", { name: "Bulan berikutnya" }).getAttribute("href")).toBe(
      "/lapor/meja/respons?month=2026-12",
    );
    expect(screen.getByText("Belum ada laporan di bulan ini.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    const door = screen.getAllByRole("link", { name: "Respons BPBD" })[0];
    expect([door?.getAttribute("href"), door?.getAttribute("aria-current")]).toEqual(["/lapor/meja/respons", "page"]);
  });

  test("months step over the year's end", () => {
    expect(monthStep("2026-12", 1)).toBe("2027-01");
    expect(monthStep("2026-01", -1)).toBe("2025-12");
  });
});
