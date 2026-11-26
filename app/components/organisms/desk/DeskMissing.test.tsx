import { screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { envelope } from "../../../../src/api/envelope";
import type { DeskMissingOne } from "../../../lib/missingTypes";
import { SUMMARY } from "../../../testing/desk";
import { renderPage } from "../../../testing/render";
import { DeskMissingView } from "./DeskMissing";

const AT = { utc: "2026-11-26T03:00:00.000Z", zone: "WIB" } as const;
const FULL: DeskMissingOne = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "open",
  place: { villageName: "Uji", districtName: "Baktiya", regencyName: "Aceh Utara" },
  name: "Siti Uji",
  nickname: "Ani",
  relation: "child",
  sex: "female",
  age: 9,
  clothes: "Kaos merah",
  marks: "Tahi lalat",
  lastSeen: { date: "2026-11-25", time: "14:30", zone: "WIB" },
  personNumber: "+6280011112222",
  contactNumber: "+6280033334444",
  waitPlace: "Posko Uji",
  reporterName: "Uji Satu",
  hasPhoto: true,
  createdAt: AT,
  history: [
    { status: "open", note: null, actor: null, at: AT },
    { status: "toSar", note: "Diserahkan", actor: "Petugas Uji", at: { ...AT, utc: "2026-11-26T04:00:00.000Z" } },
    { status: "open", note: null, actor: "Petugas Uji", at: { ...AT, utc: "2026-11-26T05:00:00.000Z" } },
  ],
};
const GONE: DeskMissingOne = {
  ...FULL,
  id: "22222222-2222-4222-8222-222222222222",
  status: "foundSafe",
  name: null,
  nickname: null,
  age: null,
  clothes: null,
  marks: null,
  lastSeen: { date: "2024-01-02", time: null, zone: "WIB" },
  personNumber: null,
  contactNumber: null,
  waitPlace: null,
  reporterName: null,
  hasPhoto: false,
  history: [],
};

// Only the missing person's own number was given.
const ONLY_PERSON: DeskMissingOne = {
  ...FULL,
  id: "33333333-3333-4333-8333-333333333333",
  name: "Budi Uji",
  contactNumber: null,
};
const ONLY_REPORTER: DeskMissingOne = {
  ...FULL,
  id: "44444444-4444-4444-8444-444444444444",
  name: "Citra Uji",
  personNumber: null,
  hasPhoto: false,
};

const draw = (props: Partial<Parameters<typeof DeskMissingView>[0]> = {}) =>
  renderPage(
    <DeskMissingView
      items={[FULL, GONE, ONLY_PERSON, ONLY_REPORTER]}
      status={null}
      summary={SUMMARY}
      saved={false}
      envelope={null}
      {...props}
    />,
    { path: "/lapor/meja/orang-hilang" },
  );

describe("the desk's missing persons", () => {
  test("a person with all they told, the numbers to call, the photo, the history and the moves left", async () => {
    draw();
    const card = (await screen.findByRole("heading", { name: "Siti Uji" })).closest("li") as HTMLElement;
    const inside = within(card);
    expect(inside.getByText("Panggilan Ani, Anak, Wanita, 9 tahun")).toBeTruthy();
    expect(inside.getByText(/^Terakhir terlihat 25 Nov 2026 jam 14\.30 WIB di Uji, Baktiya, Aceh Utara$/)).toBeTruthy();
    expect(inside.getByText("Pakaian: Kaos merah")).toBeTruthy();
    expect(inside.getByText("Ciri: Tahi lalat")).toBeTruthy();
    expect(inside.getByText("Pelapor menunggu di Posko Uji")).toBeTruthy();
    expect(inside.getByText(/oleh Uji Satu$/)).toBeTruthy();
    expect(inside.getByRole("link", { name: "Telepon pelapor +62 800-3333-4444" }).getAttribute("href")).toBe(
      "tel:+6280033334444",
    );
    expect(inside.getByRole("link", { name: "Telepon orang yang dicari +62 800-1111-2222" })).toBeTruthy();
    expect(inside.getByRole("img", { name: "Foto Siti Uji" }).getAttribute("src")).toBe(
      `/api/lapor/desk/missing/${FULL.id}/photo`,
    );
    expect(inside.getByText("Diserahkan")).toBeTruthy();
    expect(inside.getAllByText(/, oleh Petugas Uji$/)).toHaveLength(2);
    const moves = inside.getAllByRole("option").map((option) => option.textContent);
    expect(moves).toEqual(["Ditemukan selamat", "Ditemukan meninggal", "Diteruskan ke Basarnas", "Ditutup"]);
  });

  test("a person whose reporter left no number shows only the person's", async () => {
    draw();
    const card = (await screen.findByRole("heading", { name: "Budi Uji" })).closest("li") as HTMLElement;
    expect(
      within(card)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["", "Telepon orang yang dicari +62 800-1111-2222"]);
  });

  test("a person with no number of their own shows only the reporter's", async () => {
    draw();
    const card = (await screen.findByRole("heading", { name: "Citra Uji" })).closest("li") as HTMLElement;
    expect(
      within(card)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Telepon pelapor +62 800-3333-4444"]);
  });

  test("an anonymised person keeps its outcome and village, with nothing to call and no form", async () => {
    draw();
    const card = (await screen.findByRole("heading", { name: "Nama sudah dihapus" })).closest("li") as HTMLElement;
    const inside = within(card);
    expect(inside.getByText("Anak, Wanita")).toBeTruthy();
    expect(inside.getByText("Terakhir terlihat 2 Jan 2024 di Uji, Baktiya, Aceh Utara")).toBeTruthy();
    expect(inside.getByText(/^Dilaporkan .+ WIB$/)).toBeTruthy();
    expect(inside.queryByRole("link")).toBeNull();
    expect(inside.queryByRole("button")).toBeNull();
  });

  test("the filter in use is marked; a save is said, a refusal named, and an empty list says so", async () => {
    const view = draw({ items: [], status: "toSar", saved: true });
    expect((await screen.findByRole("link", { name: "Diteruskan ke Basarnas" })).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Semua" }).getAttribute("href")).toBe("/lapor/meja/orang-hilang");
    expect(screen.getByText("Status disimpan.")).toBeTruthy();
    expect(screen.getByText("Belum ada laporan orang hilang di sini.")).toBeTruthy();
    view.unmount();
    draw({ saved: true, envelope: envelope("missing.moveRefused"), summary: null });
    expect(await screen.findByText(/^Status ini tidak bisa diubah/)).toBeTruthy();
    expect(screen.queryByText("Status disimpan.")).toBeNull();
  });

  test("past the hourly limit the refusal reads as a limit", async () => {
    draw({ envelope: envelope("limit.desk.write", { params: { limit: 120 } }) });
    expect(await screen.findByText(/120/)).toBeTruthy();
  });
});
