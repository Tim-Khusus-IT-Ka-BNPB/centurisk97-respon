import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { CaseView } from "../../../../src/contract/cases";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { CASE_VIEW } from "../../../testing/cases";
import { never, renderPage } from "../../../testing/render";
import { type CaseAnswered, CaseScreen } from "./CaseScreen";

const NOTHING: CaseAnswered = { envelope: null, typed: null, link: null, revealed: null };
const draw = (
  view: CaseView = CASE_VIEW,
  tab: { kind: CaseView["records"][number]["kind"]; editing: string | null } = { kind: "house", editing: null },
  answered: CaseAnswered = NOTHING,
  entry = "/lapor/data/f000000000000001",
) =>
  renderPage(<CaseScreen view={view} tab={tab} answered={answered} />, {
    path: "/lapor/data/:fileId",
    entry,
    action: never,
  });
const envelope = (code: ErrorEnvelope["error"]["code"], fields: ErrorEnvelope["fields"] = []): ErrorEnvelope => ({
  error: { code, copyKey: `error.${code}`, params: {} },
  fields,
  retryAt: { utc: new Date(Date.now() + 20 * 60_000).toISOString(), zone: "WIB" },
  draft: null,
});
const fields = (form: HTMLFormElement) =>
  Object.fromEntries([...new FormData(form)].map(([name, value]) => [name, String(value)]));

describe("the follow-up file's screen", () => {
  test("its keeper sees the totals, a tab per kind, the records of the one open, and their tools", async () => {
    draw(CASE_VIEW, { kind: "house", editing: null }, NOTHING, "/lapor/data/f000000000000001?saved=record");
    expect(await screen.findByText("Tiket LA-241126-01")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Data tersimpan.");
    const totals = screen.getByRole("region", { name: "Rekap per 2026-11-24" });
    const dead = within(totals).getByText("Meninggal").parentElement as HTMLElement;
    expect(within(dead).getByText("nihil")).toBeTruthy();
    const unmark = within(dead).getByRole("button", { name: "Batalkan nihil" });
    expect(fields(unmark.closest("form") as HTMLFormElement)).toEqual({
      intent: "nil",
      metric: "dead",
      nil: "0",
      revision: "3",
    });
    const missing = within(totals).getByText("Hilang").parentElement as HTMLElement;
    expect(within(missing).getByText("belum didata")).toBeTruthy();
    expect(within(missing).getByRole("button", { name: "Tandai nihil" })).toBeTruthy();
    expect(within(totals).getByText("Jalan rusak (km)")).toBeTruthy();
    expect(within(totals).queryByText("Mengungsi hari ini")?.parentElement?.querySelector("button")).toBeNull();
    const tabs = screen.getByRole("navigation", { name: "Jenis data" });
    expect(within(tabs).getByRole("link", { name: "Rumah (1)" }).getAttribute("aria-current")).toBe("true");
    expect(within(tabs).getByRole("link", { name: "Pengungsi (1)" }).getAttribute("href")).toBe(
      "/lapor/data/f000000000000001?jenis=evacuee",
    );
    const [house, cancelled] = screen.getAllByRole("article") as [HTMLElement, HTMLElement];
    expect(within(house).getByText("Uji Satu")).toBeTruthy();
    expect(within(house).getByText("Rusak berat")).toBeTruthy();
    expect(within(house).getByText("Ya")).toBeTruthy();
    expect(within(house).getByText("Foto jauh dari titik")).toBeTruthy();
    expect(
      within(house)
        .getAllByRole("img")
        .map((img) => img.getAttribute("src")),
    ).toEqual([
      "/api/lapor/cases/f000000000000001/media/11111111-1111-4111-8111-111111111111",
      "/api/lapor/cases/f000000000000001/media/22222222-2222-4222-8222-222222222222",
    ]);
    expect(within(house).getByText("Titik ponsel")).toBeTruthy();
    expect(within(house).getByRole("link", { name: "Ubah" }).getAttribute("href")).toBe(
      "/lapor/data/f000000000000001?jenis=house&ubah=a000000000000001",
    );
    expect(within(house).queryByLabelText("Ini foto wajah")).toBeNull();
    expect(within(cancelled).getByText("Dibatalkan: salah ketik")).toBeTruthy();
    expect(within(cancelled).queryByRole("link", { name: "Ubah" })).toBeNull();
    expect(within(cancelled).getByText("Kurang 2 foto")).toBeTruthy();
    const add = screen.getByRole("region", { name: "Tambah Rumah" });
    expect(within(add).getByLabelText("Tingkat kerusakan")).toBeTruthy();
    expect(within(add).getByLabelText("Lintang")).toBeTruthy();
    const team = screen.getByRole("region", { name: "Tim" });
    expect(
      within(team)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringMatching(/Uji Anggota.*Aktif/),
      expect.stringMatching(/Uji Baru.*Tautan belum dipakai/),
      expect.stringMatching(/Uji Lama.*Dicabut/),
    ]);
    expect(within(team).getAllByRole("button", { name: "Tautan baru" })).toHaveLength(2);
    expect(within(team).getByRole("button", { name: "Tambah anggota" })).toBeTruthy();
    const status = screen.getByRole("region", { name: "Status penanganan" });
    expect((within(status).getByLabelText("Status darurat") as unknown as HTMLSelectElement).value).toBe(
      "emergencyResponse",
    );
    expect((within(status).getByLabelText("Nama posko") as HTMLInputElement).value).toBe("Posko Uji");
    fireEvent.click(within(house).getByRole("button", { name: "Unggah foto" }));
  });

  test("an evacuee's form ties it to a shelter and a head, and its card asks a face", async () => {
    draw(CASE_VIEW, { kind: "evacuee", editing: "c000000000000001" });
    const [person] = (await screen.findAllByRole("article")) as [HTMLElement];
    expect(within(person).getByText("Sakit, Lansia")).toBeTruthy();
    expect(within(person).getByText("Kurang foto wajah")).toBeTruthy();
    expect(within(person).getByLabelText("Ini foto wajah")).toBeTruthy();
    const form = screen.getByRole("region", { name: "Ubah Pengungsi 1" });
    expect((within(form).getByLabelText("Nama") as HTMLInputElement).value).toBe("Uji Dua");
    expect((within(form).getByLabelText("Tempat pengungsian") as unknown as HTMLSelectElement).value).toBe(
      "b000000000000001",
    );
    expect(within(form).getByRole("option", { name: "Tempat pengungsian 1" })).toBeTruthy();
    expect((within(form).getByLabelText("Kepala keluarga") as unknown as HTMLSelectElement).value).toBe("self");
    expect((within(form).getByRole("checkbox", { name: "Sakit" }) as HTMLInputElement).checked).toBe(true);
    expect((within(form).getByRole("checkbox", { name: "Menyusui" }) as HTMLInputElement).checked).toBe(false);
    expect(within(form).queryByLabelText("Lintang")).toBeNull();
    expect(within(form).getByRole("link", { name: "Batal ubah" }).getAttribute("href")).toBe(
      "/lapor/data/f000000000000001?jenis=evacuee",
    );
    const save = within(form).getByRole("button", { name: "Simpan" });
    expect(fields(save.closest("form") as HTMLFormElement)).toMatchObject({
      intent: "update",
      kind: "evacuee",
      recordId: "c000000000000001",
      revision: "0",
    });
    fireEvent.click(save);
    expect(await screen.findAllByText("Menyimpan...")).toBeTruthy();
  });

  test("a need's shelter may be none; a long text is a box of its own", async () => {
    const view = draw(CASE_VIEW, { kind: "need", editing: null });
    const form = await screen.findByRole("region", { name: "Tambah Kebutuhan" });
    expect(within(form).getByRole("option", { name: "Tanpa tempat pengungsian" })).toBeTruthy();
    expect(screen.getByText("Belum ada data Kebutuhan.")).toBeTruthy();
    view.unmount();
    const house = draw(CASE_VIEW, { kind: "house", editing: null });
    expect((await screen.findByLabelText("Keterangan")).tagName).toBe("TEXTAREA");
    house.unmount();
    const fresh = draw(CASE_VIEW, { kind: "evacuee", editing: null });
    expect(((await screen.findByRole("checkbox", { name: "Sakit" })) as HTMLInputElement).checked).toBe(false);
    fresh.unmount();
    const refused = envelope("request.invalidFields", [
      { fieldId: "vulnerable", copyKey: "fieldError.case.value", params: {} },
    ]);
    draw(CASE_VIEW, { kind: "evacuee", editing: null }, { ...NOTHING, envelope: refused, typed: { intent: "record" } });
    expect((await screen.findByRole("group", { name: "Kelompok rentan" })).getAttribute("aria-invalid")).toBe("true");
  });

  test("a refused record keeps what was typed and names each box; another refusal is told at the top", async () => {
    const refused = envelope("request.invalidFields", [
      { fieldId: "damage", copyKey: "fieldError.case.value", params: {} },
    ]);
    const typed = { intent: "record", kind: "house", "v.village": "Uji", "v.damage": "", lat: "5.1", lon: "97.2" };
    const view = draw(CASE_VIEW, { kind: "house", editing: null }, { ...NOTHING, envelope: refused, typed });
    const form = await screen.findByRole("region", { name: "Tambah Rumah" });
    expect((within(form).getByLabelText("Desa/kelurahan") as HTMLInputElement).value).toBe("Uji");
    expect((within(form).getByLabelText("Lintang") as HTMLInputElement).value).toBe("5.1");
    expect(within(form).getByLabelText("Tingkat kerusakan").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("alert")).toBeNull();
    view.unmount();
    const changed = draw(
      CASE_VIEW,
      { kind: "house", editing: null },
      { ...NOTHING, envelope: envelope("cases.changed") },
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(/baru saja diubah/);
    changed.unmount();
    const member = envelope("request.invalidFields", [
      { fieldId: "number", copyKey: "fieldError.case.value", params: {} },
    ]);
    const teamView = draw(CASE_VIEW, { kind: "house", editing: null }, { ...NOTHING, envelope: member });
    expect((await screen.findByRole("alert")).textContent).toBe("Isian ini belum diisi atau belum sesuai.");
    expect(screen.getByLabelText("Nomor HP anggota").getAttribute("aria-invalid")).toBe("true");
    teamView.unmount();
    const limited = {
      ...envelope("limit.desk.write" as ErrorEnvelope["error"]["code"]),
      error: { code: "limit.desk.write" as const, copyKey: "limit.desk.write", params: { limit: 120 } },
    };
    draw(CASE_VIEW, { kind: "house", editing: null }, { ...NOTHING, envelope: limited });
    expect((await screen.findByRole("alert")).textContent).toMatch(/120/);
  });

  test("a new member's link is shown once to send", async () => {
    draw(
      CASE_VIEW,
      { kind: "house", editing: null },
      { ...NOTHING, link: { link: "http://x/lapor/data/masuk/abc", name: "Uji Baru" } },
    );
    expect(await screen.findByText("Tautan untuk Uji Baru")).toBeTruthy();
    expect(screen.getByText("http://x/lapor/data/masuk/abc")).toBeTruthy();
  });

  test("BNPB reads masked, shows one record in full, and keeps nothing; a province its totals only", async () => {
    const bnpb: CaseView = { ...CASE_VIEW, access: "bnpb" };
    const view = draw(bnpb, { kind: "evacuee", editing: null });
    const [person] = (await screen.findAllByRole("article")) as [HTMLElement];
    const reveal = within(person).getByRole("button", { name: "Tampilkan data pribadi" });
    expect(fields(reveal.closest("form") as HTMLFormElement)).toEqual({
      intent: "reveal",
      recordId: "c000000000000001",
    });
    expect(screen.queryByRole("region", { name: /Tambah/ })).toBeNull();
    expect(within(person).queryByRole("link", { name: "Ubah" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tandai nihil" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tambah anggota" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tautan baru" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Cabut" })).toHaveLength(2);
    expect(screen.getByLabelText("Status darurat").matches(":disabled")).toBe(true);
    view.unmount();
    const shown = draw(
      bnpb,
      { kind: "evacuee", editing: null },
      {
        ...NOTHING,
        revealed: { recordId: "c000000000000001", personal: { name: "Uji Dua Penuh" } },
      },
    );
    expect(await screen.findByText("Uji Dua Penuh")).toBeTruthy();
    expect(screen.getByText("Data pribadi ditampilkan dan tercatat.")).toBeTruthy();
    shown.unmount();
    const team = draw({ ...CASE_VIEW, access: "team" }, { kind: "house", editing: null });
    expect(await screen.findByText("Anda anggota tim berkas ini.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Tim" })).toBeNull();
    expect(screen.getByRole("region", { name: "Tambah Rumah" })).toBeTruthy();
    team.unmount();
    draw({ ...CASE_VIEW, access: "province", records: [] }, { kind: "house", editing: null });
    expect(await screen.findByText("Akun provinsi melihat rekap saja.")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Jenis data" })).toBeNull();
  });

  test("a closed file takes no change", async () => {
    draw({ ...CASE_VIEW, file: { ...CASE_VIEW.file, status: "proposed" } }, { kind: "house", editing: null });
    expect(await screen.findAllByText("Menunggu diterima BNPB")).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "Tambah Rumah" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tandai nihil" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Ubah" })).toBeNull();
  });
});

describe("what is being saved", () => {
  test("each form says so while it is posted", async () => {
    const quiet = { ...CASE_VIEW, file: { ...CASE_VIEW.file, fields: {} }, members: [] };
    const view = draw(quiet, { kind: "shelter", editing: "b000000000000001" });
    const [shelter] = (await screen.findAllByRole("article")) as [HTMLElement];
    expect(within(shelter).getByText("Tidak")).toBeTruthy();
    expect(within(shelter).getByText("Meunasah Uji")).toBeTruthy();
    expect((screen.getByLabelText("Butuh air") as unknown as HTMLSelectElement).value).toBe("no");
    expect((screen.getByLabelText("Nama posko") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("Belum ada anggota tim.")).toBeTruthy();
    fireEvent.change(within(shelter).getByLabelText("Alasan pembatalan"), { target: { value: "salah ketik" } });
    fireEvent.click(within(shelter).getByRole("button", { name: "Batalkan data ini" }));
    expect(await within(shelter).findByText("Menyimpan...")).toBeTruthy();
    view.unmount();
    const fields = draw(CASE_VIEW, { kind: "house", editing: null });
    fireEvent.click(
      within(await screen.findByRole("region", { name: "Status penanganan" })).getByRole("button", { name: "Simpan" }),
    );
    expect(await screen.findByText("Menyimpan...")).toBeTruthy();
    fields.unmount();
    const member = draw(CASE_VIEW, { kind: "house", editing: null });
    fireEvent.click(await screen.findByRole("button", { name: "Tambah anggota" }));
    expect(await screen.findByText("Menyimpan...")).toBeTruthy();
    member.unmount();
    const renew = draw(CASE_VIEW, { kind: "house", editing: null });
    const [first] = await screen.findAllByRole("button", { name: "Tautan baru" });
    fireEvent.click(first as HTMLElement);
    expect(await screen.findByText("Menyimpan...")).toBeTruthy();
    renew.unmount();
    const remove = draw(CASE_VIEW, { kind: "house", editing: null });
    const [cut] = await screen.findAllByRole("button", { name: "Cabut" });
    fireEvent.click(cut as HTMLElement);
    expect(await screen.findByText("Menyimpan...")).toBeTruthy();
    remove.unmount();
    draw(CASE_VIEW, { kind: "house", editing: "a000000000000001" });
    const [house] = (await screen.findAllByRole("article")) as [HTMLElement];
    expect((screen.getByLabelText("Lintang") as HTMLInputElement).value).toBe("5.1");
    expect(within(house).getByRole("button", { name: "Unggah foto" })).toBeTruthy();
  });

  test("a record with nothing to flag has no chips", async () => {
    const clean = {
      ...CASE_VIEW,
      records: [
        { ...(CASE_VIEW.records[0] as CaseView["records"][number]), flags: [], missingPhotos: { photo: 0, face: 0 } },
      ],
    };
    draw(clean, { kind: "house", editing: null });
    const [house] = (await screen.findAllByRole("article")) as [HTMLElement];
    expect(within(house).queryByRole("list", { name: "Foto" })).toBeNull();
  });
});

describe("closing the file", () => {
  const VERSION = {
    version: 1,
    at: { utc: "2026-11-26T03:00:00.000Z", zone: "WIB" as const },
    by: "Petugas Uji",
    fingerprint: "a".repeat(64),
    final: { status: "doneNoted" as const, reasons: [{ metric: "missing", value: 2 }], notRecorded: [] },
    closing: { endedOn: "2026-11-26", note: "Air surut" },
  };

  test("its keeper is asked if the event ended, shown what keeps it noted, and closes it", async () => {
    draw(CASE_VIEW, { kind: "house", editing: null }, NOTHING, "/lapor/data/f000000000000001?saved=close");
    expect((await screen.findByRole("status")).textContent).toBe("Berkas ditutup dan menunggu diterima BNPB.");
    const closing = await screen.findByRole("region", { name: "Kejadian sudah selesai?" });
    expect(within(closing).getByText(/selesai dengan catatan/)).toBeTruthy();
    expect(within(closing).getByText("Hilang: belum didata")).toBeTruthy();
    expect((within(closing).getByLabelText("Tanggal kejadian selesai") as HTMLInputElement).value).toBe("2026-11-24");
    const close = within(closing).getByRole("button", { name: "Tutup berkas" });
    expect(fields(close.closest("form") as HTMLFormElement)).toMatchObject({ intent: "close", revision: "3" });
    fireEvent.click(close);
    expect(await within(closing).findByText("Menyimpan...")).toBeTruthy();
  });

  test("a clean preview says so; a team member is told who closes", async () => {
    const clean = { ...CASE_VIEW, final: { status: "done" as const, reasons: [], notRecorded: [] } };
    const view = draw(clean, { kind: "house", editing: null });
    expect(await screen.findByText(/Bila ditutup hari ini: selesai\./)).toBeTruthy();
    view.unmount();
    draw({ ...CASE_VIEW, access: "team" }, { kind: "house", editing: null });
    expect(await screen.findByText("Berkas ditutup oleh BPBD kabupaten/kota yang mengelolanya.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tutup berkas" })).toBeNull();
  });

  test("BNPB accepts a proposed closing or opens it again; each version is listed", async () => {
    const proposed: CaseView = {
      ...CASE_VIEW,
      access: "bnpb",
      file: { ...CASE_VIEW.file, status: "proposed" },
      versions: [VERSION],
    };
    const view = draw(proposed, { kind: "house", editing: null });
    const closing = await screen.findByRole("region", { name: "Menunggu diterima BNPB" });
    const accept = within(closing).getByRole("button", { name: "Terima penutupan" });
    fireEvent.click(accept);
    expect(await within(closing).findByText("Menyimpan...")).toBeTruthy();
    view.unmount();
    const again = draw(proposed, { kind: "house", editing: null });
    const reopen = await screen.findByRole("button", { name: "Buka lagi" });
    fireEvent.change(screen.getByLabelText("Alasan membuka lagi"), { target: { value: "salah tutup" } });
    fireEvent.click(reopen);
    expect(await screen.findByText("Menyimpan...")).toBeTruthy();
    again.unmount();
    const done: CaseView = {
      ...proposed,
      file: { ...proposed.file, status: "done" },
      versions: [
        {
          ...VERSION,
          closing: { endedOn: "2026-11-26", note: null },
          final: { status: "done", reasons: [], notRecorded: [] },
        },
      ],
    };
    draw(done, { kind: "house", editing: null });
    const versions = await screen.findByRole("list", { name: "Versi beku" });
    expect(within(versions).getByText("Versi 1: Selesai, kejadian selesai 2026-11-26")).toBeTruthy();
    expect(within(versions).getByText("a".repeat(64))).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Terima penutupan" })).toBeNull();
    expect(screen.getByRole("button", { name: "Buka lagi" })).toBeTruthy();
  });

  test("a version noted lists why, with its note", async () => {
    draw(
      { ...CASE_VIEW, file: { ...CASE_VIEW.file, status: "doneNoted" }, versions: [VERSION] },
      { kind: "house", editing: null },
    );
    const versions = await screen.findByRole("list", { name: "Versi beku" });
    expect(within(versions).getByText("Hilang: 2")).toBeTruthy();
    expect(within(versions).getByText("Air surut")).toBeTruthy();
  });
});
