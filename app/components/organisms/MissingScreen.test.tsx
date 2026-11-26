import { screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { envelope } from "../../../src/api/envelope";
import type { MissingLoad } from "../../lib/missingTypes";
import { renderPage } from "../../testing/render";
import { MissingScreen } from "./MissingScreen";

const VILLAGE = { code: "11.08.01.2001", name: "Uji", districtName: "Baktiya", regencyName: "Aceh Utara" };
const FORM: Extract<MissingLoad, { kind: "form" }> = {
  kind: "form",
  texts: {},
  query: "uji",
  search: { kind: "results", villages: [VILLAGE] },
  mine: [],
  sent: false,
};

const draw = (load: MissingLoad, problem: ReturnType<typeof envelope> | null = null) =>
  renderPage(<MissingScreen load={load} envelope={problem} />, { path: "/lapor/orang-hilang" });

describe("the missing person page", () => {
  test("a phone that has not said who reports is led to say so, and back", async () => {
    draw({ kind: "whoFirst", texts: {} });
    expect((await screen.findByRole("link", { name: "Isi data pelapor" })).getAttribute("href")).toBe(
      "/lapor/report?hilang=1",
    );
    expect(screen.queryByRole("button", { name: "Kirim laporan orang hilang" })).toBeNull();
  });

  test("the search says when it is short, finds nothing, or cannot be used; the form waits for a village", async () => {
    for (const [kind, line] of [
      ["short", "Ketik paling sedikit 3 huruf."],
      ["none", /^Desa tidak ditemukan/],
      ["unavailable", /^Pencarian desa sedang tidak bisa/],
    ] as const) {
      const view = draw({ ...FORM, search: { kind } });
      expect(await screen.findByText(line)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Kirim laporan orang hilang" })).toBeNull();
      view.unmount();
    }
  });

  test("one village found is already chosen; a refusal names its fields and keeps what was typed", async () => {
    const wrong = {
      ...envelope("request.invalidFields"),
      fields: [
        { fieldId: "relation", copyKey: "fieldError.missing.choose", params: {} },
        { fieldId: "villageCode", copyKey: "fieldError.missing.choose", params: {} },
      ],
    };
    renderPage(<MissingScreen load={FORM} envelope={wrong} typed={{ sex: "male", lastSeenDate: "2026-11-25" }} />, {
      path: "/lapor/orang-hilang",
    });
    expect(((await screen.findByLabelText("Uji, Baktiya, Aceh Utara")) as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByText("Pilih salah satu.")).toHaveLength(2);
    expect((screen.getByLabelText("Pria") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Tanggal terakhir terlihat") as HTMLInputElement).value).toBe("2026-11-25");
  });

  test("with two villages none is chosen; a refusal of the whole is said above the form", async () => {
    draw(
      { ...FORM, search: { kind: "results", villages: [VILLAGE, { ...VILLAGE, code: "11.08.01.2002", name: "Dua" }] } },
      envelope("missing.tooMany"),
    );
    expect(((await screen.findByLabelText("Uji, Baktiya, Aceh Utara")) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/^Nomor ini sudah mengirim 5 laporan/)).toBeTruthy();
  });

  test("once sent, says so and lists this phone's reports, a removed name too", async () => {
    draw({
      ...FORM,
      sent: true,
      search: { kind: "start" },
      mine: [
        { id: "a", name: "Uji Hilang", status: "open", villageName: "Uji", createdAt: "2026-11-26T03:00:00.000Z" },
        { id: "b", name: null, status: "closed", villageName: "Dua", createdAt: "2026-11-25T03:00:00.000Z" },
      ],
    });
    expect(await screen.findByRole("heading", { name: "Laporan orang hilang terkirim" })).toBeTruthy();
    expect(screen.getByText("Uji Hilang, terakhir terlihat di Uji")).toBeTruthy();
    expect(screen.getByText("Nama sudah dihapus, terakhir terlihat di Dua")).toBeTruthy();
    expect(screen.getByText("Ditutup")).toBeTruthy();
  });
});
