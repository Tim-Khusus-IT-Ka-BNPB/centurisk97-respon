import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { never, renderPage } from "../../../testing/render";
import { DeskToday } from "./DeskToday";

const ALL = { valid: true, bpbd: true, ticket: true, version: true, pull: true };
const draw = (today: Parameters<typeof DeskToday>[0]["today"]) =>
  renderPage(<DeskToday today={today} />, { path: "/lapor/meja/LA-261126-01", action: never });

describe("the today page on a report", () => {
  test("lists the five conditions met or not, and a shown report is pulled off", async () => {
    draw({ conditions: ALL, shown: true });
    expect(await screen.findByText("Tampil di halaman Hari ini sekarang.")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Pengecekan terakhir Valid, terpenuhi",
      "Dicek BPBD wilayah laporan, terpenuhi",
      "Tiket bukan Tidak valid, terpenuhi",
      "Tidak ada perubahan sesudah pengecekan, terpenuhi",
      "Tidak ditarik dari halaman publik, terpenuhi",
    ]);
    const pull = screen.getByRole("button", { name: "Tarik dari halaman publik" });
    const form = pull.closest("form") as HTMLFormElement;
    expect((form.elements.namedItem("action") as HTMLInputElement).value).toBe("today");
    expect((form.elements.namedItem("pulled") as HTMLInputElement).value).toBe("1");
    expect(screen.getByRole("link", { name: "Buka halaman Hari ini" }).getAttribute("href")).toBe("/lapor/hari-ini");
    fireEvent.click(pull);
    expect(await screen.findByText("Menyimpan...")).toBeTruthy();
  });

  test("a pulled report is put back, its unmet conditions named", async () => {
    draw({ conditions: { ...ALL, bpbd: false, pull: false }, shown: false });
    expect(await screen.findByText("Belum tampil di halaman Hari ini.")).toBeTruthy();
    expect(screen.getByText("Dicek BPBD wilayah laporan").textContent).toBe(
      "Dicek BPBD wilayah laporan, belum terpenuhi",
    );
    const back = screen.getByRole("button", { name: "Tampilkan lagi" });
    expect(((back.closest("form") as HTMLFormElement).elements.namedItem("pulled") as HTMLInputElement).value).toBe(
      "0",
    );
  });
});
