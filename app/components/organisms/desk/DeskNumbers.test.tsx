import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { envelope } from "../../../../src/api/envelope";
import type { DeskBpbdNumbers, DeskFacilityNumbers } from "../../../../src/contract/numbers";
import type { NumbersView } from "../../../lib/numbersView";
import { SUMMARY } from "../../../testing/desk";
import { never, renderPage } from "../../../testing/render";
import type { NumbersRefused } from "./DeskNumberForms";
import { DeskNumbersView } from "./DeskNumbers";

const AT = { utc: "2026-11-26T10:00:00.000Z", zone: "WIB" } as const;
const WA = { nomor: "0811 2222 3333", jenis: "wa", url: null, lama: false };
const OFFICE = { nomor: "0645 41234", jenis: "kantor", url: null, lama: false };

const BPBD: DeskBpbdNumbers = {
  checksum: "abc",
  total: 120,
  page: 2,
  pages: 3,
  areas: [
    { code: "11", name: "Aceh", provinceName: "Aceh", level: "province", numbers: [] },
    {
      code: "1108",
      name: "Aceh Utara",
      provinceName: "Aceh",
      level: "regency",
      numbers: [
        { index: 0, nomor: "0800-1108-0002", jenis: "kantor", url: "https://bpbd.example.go.id", lama: true },
        { index: 1, nomor: "(0645) 41234", jenis: "sms", url: null, lama: false },
      ],
    },
    { code: "1101", name: "Aceh Selatan", provinceName: "Aceh", level: "regency", numbers: [] },
    { code: "9901", name: "Kab. Uji", provinceName: "", level: "regency", numbers: [] },
  ],
  changes: [
    { id: 4, at: AT, change: "removed", by: "Petugas Uji", entry: "Aceh Utara", before: WA, after: null },
    { id: 3, at: AT, change: "changed", by: "Petugas Uji", entry: "Aceh Utara", before: OFFICE, after: WA },
    { id: 2, at: AT, change: "added", by: "Petugas Uji", entry: "Aceh Utara", before: null, after: OFFICE },
    { id: 1, at: AT, change: "imported" },
  ],
};

const RS = { kind: "rs", lat: 4.15595, lon: 96.13028, name: "RSUD Uji", phone: "+626557009452" } as const;
const POLICE = { kind: "polisi", lat: 3.59, lon: 98.67, name: "Polsek Uji", phone: "110" } as const;

const FACILITIES: DeskFacilityNumbers = {
  checksum: "def",
  total: 2,
  page: 1,
  pages: 1,
  facilities: [{ index: 7, ...RS }],
  changes: [
    { id: 9, at: AT, change: "removed", by: "Petugas Uji", entry: "Polsek Uji", before: POLICE, after: null },
    { id: 8, at: AT, change: "changed", by: "Petugas Uji", entry: "RSUD Uji", before: POLICE, after: RS },
    { id: 7, at: AT, change: "added", by: "Petugas Uji", entry: "Polsek Uji", before: null, after: POLICE },
    { id: 6, at: AT, change: "imported" },
  ],
};

const bpbd = (change: Partial<DeskBpbdNumbers> = {}, empty = false): NumbersView => ({
  tab: "bpbd",
  search: { q: "", empty },
  list: { ...BPBD, ...change },
});
const facilities = (change: Partial<DeskFacilityNumbers> = {}): NumbersView => ({
  tab: "facilities",
  search: { q: "rsud", kind: "rs" },
  list: { ...FACILITIES, ...change },
});

const refusedOn = (form: string, values: Record<string, string>, fields: readonly string[]): NumbersRefused => ({
  envelope: envelope("request.invalidFields", {
    fields: fields.map((fieldId) => ({ fieldId, copyKey: `desk.numbers.error.${fieldId}`, params: {} })),
  }),
  typed: { values: { form, ...values }, actions: [] },
});

const draw = (
  view: NumbersView,
  props: Partial<Omit<Parameters<typeof DeskNumbersView>[0], "view">> = {},
  action?: () => Promise<never>,
) =>
  renderPage(<DeskNumbersView view={view} summary={SUMMARY} saved={null} refused={null} {...props} />, {
    path: "/desk/numbers",
    action,
  });

const card = async (name: string) => (await screen.findByRole("heading", { name })).closest("li") as HTMLElement;
const hidden = (scope: HTMLElement, name: string) =>
  [...scope.querySelectorAll<HTMLInputElement>(`input[type=hidden][name=${name}]`)].map((one) => one.value);

describe("the desk's BPBD numbers", () => {
  test("each area with its numbers, what a reporter sees when it has none, and the steps to change them", async () => {
    draw(bpbd());
    expect(await screen.findByRole("heading", { level: 1, name: "Nomor BPBD dan fasilitas" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Nomor BPBD" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Nomor fasilitas" }).getAttribute("href")).toBe(
      "/desk/numbers?tab=facilities",
    );
    expect(screen.getByText("120 wilayah")).toBeTruthy();
    expect(within(await card("Aceh")).getByText("Provinsi")).toBeTruthy();
    expect(within(await card("Aceh")).getByText(/melihat nomor BNPB 117\.$/)).toBeTruthy();
    expect(within(await card("Aceh Selatan")).getByText("Kabupaten/kota di Aceh")).toBeTruthy();
    expect(within(await card("Aceh Selatan")).getByText(/nomor BPBD provinsi, atau 117/)).toBeTruthy();
    expect(within(await card("Kab. Uji")).getByText("Kode 9901, tidak ada di data wilayah")).toBeTruthy();
    const utara = within(await card("Aceh Utara"));
    expect(utara.getByRole("link", { name: "0800-1108-0002" }).getAttribute("href")).toBe("tel:080011080002");
    expect(utara.getByRole("link", { name: "(0645) 41234" }).getAttribute("href")).toBe("tel:064541234");
    expect(utara.getAllByText("Kantor", { selector: "span" })).toHaveLength(1);
    expect(utara.getByText("sms")).toBeTruthy();
    expect(utara.getByText("Nomor lama, tidak ditampilkan")).toBeTruthy();
    const source = utara.getByRole("link", { name: "Halaman sumber" });
    expect([source.getAttribute("href"), source.getAttribute("target")]).toEqual([
      "https://bpbd.example.go.id",
      "_blank",
    ]);
    expect(utara.getAllByText("Ubah")).toHaveLength(2);
    expect(utara.getAllByRole("button", { name: "Ya, hapus nomor" })).toHaveLength(2);
    const scope = (await card("Aceh Utara")) as HTMLElement;
    expect(hidden(scope, "form")).toEqual([
      "change-1108-0",
      "remove-1108-0",
      "change-1108-1",
      "remove-1108-1",
      "add-1108",
    ]);
    expect(hidden(scope, "edit")).toEqual(["change", "remove", "change", "remove", "add"]);
    expect(hidden(scope, "index")).toEqual(["0", "0", "1", "1"]);
    expect(new Set([...hidden(scope, "code"), ...hidden(scope, "checksum"), ...hidden(scope, "tab")])).toEqual(
      new Set(["1108", "abc", "bpbd"]),
    );
    const kept = scope.querySelector<HTMLInputElement>("input[id='change-1108-0-nomor']");
    expect(kept?.value).toBe("0800-1108-0002");
    expect(scope.querySelector<HTMLInputElement>("input[id='change-1108-0-url']")?.value).toBe(
      "https://bpbd.example.go.id",
    );
    expect(scope.querySelectorAll<HTMLInputElement>("input[name=lama]")[0]?.checked).toBe(true);
    expect(scope.querySelector<HTMLSelectElement>("select[id='add-1108-jenis']")?.value).toBe("call_center");
    expect(screen.getByText("Halaman 2 dari 3")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Halaman sebelumnya" }).getAttribute("href")).toBe("/desk/numbers");
    expect(screen.getByRole("link", { name: "Halaman berikutnya" }).getAttribute("href")).toBe("/desk/numbers?page=3");
    const history = within(screen.getByRole("region", { name: "Riwayat perubahan" }));
    expect(history.getAllByRole("listitem").map((item) => item.lastChild?.textContent)).toEqual([
      "Petugas Uji menghapus 0811 2222 3333 (WhatsApp) dari Aceh Utara.",
      "Petugas Uji mengubah 0645 41234 (Kantor) menjadi 0811 2222 3333 (WhatsApp) di Aceh Utara.",
      "Petugas Uji menambahkan 0645 41234 (Kantor) di Aceh Utara.",
      "Seluruh data dimuat dari berkas impor.",
    ]);
  });

  test("a search with nothing found says so, a kept edit is said, and a list never changed says that", async () => {
    draw(bpbd({ areas: [], total: 0, page: 1, pages: 1, changes: [] }, true), { saved: "added", summary: null });
    expect(await screen.findByText(/^Tidak ada wilayah yang cocok/)).toBeTruthy();
    expect(within(screen.getByRole("status")).getByText("Tersimpan. Pelapor melihatnya mulai sekarang.")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Hanya wilayah tanpa nomor untuk pelapor" })).toHaveProperty(
      "checked",
      true,
    );
    expect(screen.queryByRole("link", { name: "Halaman berikutnya" })).toBeNull();
    expect(screen.getByText("Belum ada perubahan.")).toBeTruthy();
  });

  test("a refused number comes back in its own form, open, with what was typed and why", async () => {
    const refused = refusedOn("change-1108-0", { nomor: "12", jenis: "wa", lama: "on" }, ["nomor", "url"]);
    draw(bpbd(), { saved: "changed", refused });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    const scope = (await card("Aceh Utara")) as HTMLElement;
    const nomor = scope.querySelector<HTMLInputElement>("input[id='change-1108-0-nomor']") as HTMLInputElement;
    expect([nomor.value, nomor.getAttribute("aria-invalid"), document.activeElement]).toEqual(["12", "true", nomor]);
    expect(nomor.closest("details")?.open).toBe(true);
    expect(within(scope).getByText(/^Nomor belum terbaca/)).toBeTruthy();
    expect(scope.querySelector<HTMLInputElement>("input[id='change-1108-0-url']")?.value).toBe("");
    expect(scope.querySelector<HTMLSelectElement>("select[id='change-1108-0-jenis']")?.value).toBe("wa");
    expect(scope.querySelectorAll<HTMLInputElement>("input[name=lama]")[0]?.checked).toBe(true);
    expect(scope.querySelector<HTMLInputElement>("input[id='change-1108-1-nomor']")?.value).toBe("(0645) 41234");
    expect(scope.querySelector<HTMLInputElement>("input[id='change-1108-1-nomor']")?.closest("details")?.open).toBe(
      false,
    );
  });

  test("an hourly limit is named as a limit", async () => {
    const limit = {
      envelope: envelope("limit.desk.write", { params: { limit: 300 } }),
      typed: { values: {}, actions: [] },
    };
    draw(bpbd(), { refused: limit });
    expect(await screen.findByText(/300/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a form on its way says it is saving", async () => {
    draw(bpbd(), {}, never);
    const scope = (await card("Aceh Selatan")) as HTMLElement;
    fireEvent.click(within(scope).getByRole("button", { name: "Tambah nomor" }));
    expect(await within(scope).findByRole("button", { name: "Menyimpan..." })).toBeTruthy();
  });
});

describe("the desk's facility numbers", () => {
  test("each facility with its kind, point and number, the step to add one, and what changed", async () => {
    draw(facilities());
    expect((await screen.findByRole("link", { name: "Nomor fasilitas" })).getAttribute("aria-current")).toBe("page");
    expect(document.getElementById("numbers-kind")).toHaveProperty("value", "rs");
    expect(screen.getByRole("searchbox", { name: "Cari nama atau nomor fasilitas" })).toHaveProperty("value", "rsud");
    expect(screen.getByText("2 fasilitas")).toBeTruthy();
    const rs = within(await card("RSUD Uji"));
    expect(rs.getByText("Rumah sakit, Titik 4,15595, 96,13028")).toBeTruthy();
    expect(rs.getByRole("link", { name: "+626557009452" }).getAttribute("href")).toBe("tel:+626557009452");
    const scope = (await card("RSUD Uji")) as HTMLElement;
    expect(hidden(scope, "form")).toEqual(["change-7", "remove-7"]);
    expect(hidden(scope, "code")).toEqual([]);
    expect(scope.querySelector<HTMLInputElement>("input[id='change-7-lat']")?.value).toBe("4.15595");
    expect(rs.getByText(/^Hapus RSUD Uji\?/)).toBeTruthy();
    expect(screen.getByText("Tambah fasilitas", { selector: "summary" })).toBeTruthy();
    const history = within(screen.getByRole("region", { name: "Riwayat perubahan" }));
    expect(history.getAllByRole("listitem").map((item) => item.lastChild?.textContent)).toEqual([
      "Petugas Uji menghapus Polsek Uji (Polisi, 110).",
      "Petugas Uji mengubah Polsek Uji (Polisi, 110) menjadi RSUD Uji (Rumah sakit, +626557009452).",
      "Petugas Uji menambahkan Polsek Uji (Polisi, 110).",
      "Seluruh data dimuat dari berkas impor.",
    ]);
  });

  test("a refused facility comes back open, its point marked on both axes and focus on the first", async () => {
    const refused = refusedOn("add", { kind: "damkar", name: "Damkar Uji", phone: "113", lat: "70" }, ["point"]);
    // No file yet, and no kind asked for.
    draw(
      {
        tab: "facilities",
        search: { q: "", kind: null },
        list: { ...FACILITIES, facilities: [], total: 0, checksum: null },
      },
      { refused },
    );
    expect(await screen.findByText(/^Tidak ada fasilitas yang cocok/)).toBeTruthy();
    const lat = screen.getByRole("textbox", { name: "Lintang" }) as HTMLInputElement;
    const lon = screen.getByRole("textbox", { name: "Bujur" }) as HTMLInputElement;
    expect([lat.value, lon.value, document.activeElement]).toEqual(["70", "", lat]);
    expect([lat.getAttribute("aria-invalid"), lon.getAttribute("aria-invalid")]).toEqual(["true", "true"]);
    expect(lon.getAttribute("aria-describedby")).toBe("add-point-hint add-point-error");
    expect(screen.getByText(/^Titik itu di luar Indonesia/)).toBeTruthy();
    expect(document.getElementById("add-kind")).toHaveProperty("value", "damkar");
    expect(document.getElementById("numbers-kind")).toHaveProperty("value", "");
    expect(hidden(document.body, "checksum")).toEqual([""]);
    expect((screen.getByRole("textbox", { name: "Nama fasilitas" }) as HTMLInputElement).value).toBe("Damkar Uji");
  });
});
