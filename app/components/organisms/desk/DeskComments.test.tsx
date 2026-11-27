import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { DeskReport } from "../../../../src/contract/desk";
import { never, renderPage } from "../../../testing/render";
import { DeskComments } from "./DeskComments";

type Comments = NonNullable<DeskReport["comments"]>;
const AT = { utc: "2026-11-24T03:00:00.000Z", zone: "WIB" } as const;
const COMMENTS: Comments = {
  items: [
    {
      id: "0123456789abcdef",
      text: "Dua orang meninggal, 40 rumah rusak",
      status: "shown",
      reports: 0,
      at: AT,
      authorHidden: 0,
      figures: [
        { id: 1, figure: "dead", value: 2, quote: "dua orang meninggal", status: "proposed" },
        { id: 2, figure: "houses", value: 40, quote: "40 rumah rusak", status: "proposed" },
      ],
      decisions: [],
    },
    {
      id: "fedcba9876543210",
      text: "hoaks",
      status: "hidden",
      reports: 3,
      at: AT,
      authorHidden: 2,
      figures: [
        { id: 3, figure: "injured", value: 1, quote: "1 orang luka", status: "accepted" },
        { id: 4, figure: "missing", value: 1, quote: "1 hilang", status: "rejected" },
      ],
      decisions: [
        { action: "hide", fieldId: null, reason: "tidak benar", by: "Petugas Uji", at: AT },
        { action: "accept", fieldId: "injured", reason: null, by: "Petugas Uji", at: AT },
      ],
    },
  ],
};
const draw = () => renderPage(<DeskComments comments={COMMENTS} />, { path: "/desk/LA-241126-01", action: never });
const fields = (form: HTMLFormElement) =>
  Object.fromEntries([...new FormData(form)].map(([name, value]) => [name, String(value)]));

describe("the residents' news on a report", () => {
  test("each with its status, reports and author, its figures to take or turn down, and a hide", async () => {
    draw();
    const [shown, hidden] = (await screen.findAllByRole("listitem", { name: "" })).filter(
      (item) => item.parentElement?.tagName === "OL" && item.querySelector("p"),
    ) as [HTMLElement, HTMLElement];
    expect(within(shown).getByText("Tampil")).toBeTruthy();
    const figures = within(shown).getByRole("list", { name: "Angka dari kabar ini" });
    expect(within(figures).getByText("Meninggal: 2")).toBeTruthy();
    const [take] = within(figures).getAllByRole("button", { name: "Terima ke laporan" }) as [HTMLButtonElement];
    expect(fields(take.closest("form") as HTMLFormElement)).toEqual({ action: "figure", figureId: "1", reason: "" });
    expect(within(figures).getByLabelText("Tingkat kerusakan")).toBeTruthy();
    const hide = within(shown).getByRole("button", { name: "Sembunyikan" });
    expect(fields(hide.closest("form") as HTMLFormElement)).toEqual({
      action: "commentShown",
      commentId: "0123456789abcdef",
      shown: "0",
      reason: "",
    });
    fireEvent.click(hide);
    expect(await screen.findByText("Menyimpan...")).toBeTruthy();

    expect(within(hidden).getByText("Disembunyikan petugas")).toBeTruthy();
    expect(within(hidden).getByText("Dilaporkan 3 orang")).toBeTruthy();
    expect(within(hidden).getByText("2 kabar penulis ini pernah disembunyikan")).toBeTruthy();
    expect(within(hidden).getByText("Diterima ke laporan.")).toBeTruthy();
    expect(within(hidden).getByText("Ditolak.")).toBeTruthy();
    expect(within(hidden).getByText(/^Disembunyikan oleh Petugas Uji, .*: tidak benar$/)).toBeTruthy();
    expect(within(hidden).getByText(/^Angka diterima oleh Petugas Uji, [^:]*$/)).toBeTruthy();
    const show = within(hidden).getByRole("button", { name: "Tampilkan lagi" });
    expect(fields(show.closest("form") as HTMLFormElement)).toMatchObject({ shown: "1" });
  });

  test("taking a figure says so while it is saved", async () => {
    draw();
    const [take] = (await screen.findAllByRole("button", { name: "Terima ke laporan" })) as [HTMLButtonElement];
    fireEvent.click(take);
    expect(await screen.findByText("Menyimpan...")).toBeTruthy();
  });
});
