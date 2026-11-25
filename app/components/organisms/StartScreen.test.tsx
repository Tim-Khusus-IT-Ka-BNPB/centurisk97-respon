import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import { SAMPLE_DRAFTS, SAMPLE_FIELD_ERROR, SAMPLE_ME } from "../../../src/testing/samples";
import type { StartActionData, StartPageData } from "../../lib/startTypes";
import { ALL_TEXTS, never, renderPage } from "../../testing/render";
import { HomeHero } from "./HomeHero";
import { HomeScreen } from "./HomeScreen";
import { StartScreen } from "./StartScreen";

const profile = SAMPLE_ME.knownReporters[0] as (typeof SAMPLE_ME.knownReporters)[number];
const withDraft = {
  ...profile,
  openDraft: { ...(profile.openDraft as NonNullable<typeof profile.openDraft>), hazardType: "flood" },
};
const page = (extra: Partial<StartPageData> = {}): StartPageData => ({
  me: {
    ...SAMPLE_ME,
    knownReporters: [withDraft, { ...profile, profileId: "p-2", openDraft: null, role: "claimedOfficer" }],
  },
  view: "list",
  profileId: null,
  editing: false,
  emergency: false,
  texts: ALL_TEXTS,
  ...extra,
});
const EMPTY = { role: "", name: "", number: "", officerRegency: "", officerPosition: "" };
const acted = (extra: Partial<StartActionData>): StartActionData => ({
  view: "form",
  values: EMPTY,
  profileId: null,
  editing: false,
  readBack: null,
  envelope: null,
  removed: null,
  removeFailed: null,
  focusNumber: false,
  ...extra,
});
const draw = (data: StartPageData, action: StartActionData | null = null) =>
  renderPage(<StartScreen page={data} acted={action} />, { path: "/lapor/report", action: never });

describe("numbers known on this device", () => {
  test("each row names the reporter and masked number, with its own removal, its open draft, then Nomor lain", async () => {
    draw(page());
    expect(await screen.findByRole("heading", { name: "Pilih pelapor" })).toBeTruthy();
    const row = screen.getByRole("link", { name: "Uji Satu, 0800****0001 (Warga)" });
    expect(row.getAttribute("href")).toContain(`?profile=${profile.profileId}`);
    expect(screen.getByRole("link", { name: "Uji Satu, 0800****0001 (Petugas BPBD)" })).toBeTruthy();
    const removes = screen.getAllByRole("button", { name: "Hapus dari perangkat ini" });
    expect(removes[0]?.getAttribute("aria-describedby")).toBe(row.id);
    expect(screen.getByText("Banjir, terakhir diubah pukul 08.01 WIB.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lanjutkan laporan" }).getAttribute("href")).toBe(
      `/lapor/report/${withDraft.openDraft.draftId}`,
    );
    expect(screen.getByRole("link", { name: "Nomor lain" }).getAttribute("href")).toContain("?new=1");
  });

  test("an emergency stays one through every step", async () => {
    renderPage(<StartScreen page={page({ emergency: true })} acted={null} />, {
      path: "/lapor/report",
      entry: "/lapor/report?darurat=1",
      action: never,
    });
    const hrefs = (await screen.findAllByRole("link")).map((link) => link.getAttribute("href"));
    expect(hrefs).toContain(`/lapor/report?profile=${profile.profileId}&darurat=1`);
    expect(hrefs).toContain("/lapor/report?new=1&darurat=1");
  });

  test("after a removal the number removed is named; a failed removal says so", async () => {
    draw(page(), acted({ view: "list", removed: "0800****0009" }));
    expect(await screen.findByText(/0800\*\*\*\*0009 sudah dihapus/)).toBeTruthy();
    draw(page(), acted({ view: "list", removeFailed: "0800****0009" }));
    expect(await screen.findByText(/belum terhapus/)).toBeTruthy();
  });

  test("a picked number asks to confirm, with Ganti first and Ya last", async () => {
    draw(page({ view: "confirm", profileId: profile.profileId }));
    expect(await screen.findByRole("heading", { name: "Melapor sebagai Uji Satu (Warga)?" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ganti" }).getAttribute("href")).toContain(`?edit=${profile.profileId}`);
    fireEvent.click(screen.getByRole("button", { name: "Ya" }));
    await screen.findByRole("button", { name: "Menyimpan jawaban..." });
  });

  test("removal asks first, naming the number and what is lost", async () => {
    draw(page(), acted({ view: "removeConfirm", profileId: profile.profileId }));
    expect(await screen.findByRole("heading", { name: "Hapus Uji Satu dari perangkat ini?" })).toBeTruthy();
    expect((document.querySelector('input[name="maskedNumber"]') as HTMLInputElement).value).toBe("0800****0001");
    expect(screen.getByRole("link", { name: "Simpan nomor ini" })).toBeTruthy();
  });

  test("a new report over an open one asks first, naming its hazard type", async () => {
    draw(page(), acted({ view: "replaceConfirm", profileId: profile.profileId }));
    expect(await screen.findByText(/Laporan yang belum selesai \(Banjir\)/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lanjutkan laporan lama" })).toBeTruthy();
    draw(
      page({ me: { ...SAMPLE_ME, knownReporters: [profile] } }),
      acted({ view: "replaceConfirm", profileId: profile.profileId }),
    );
    expect(await screen.findByText(/\(Jenis belum dipilih\)/)).toBeTruthy();
  });
});

describe("identity and consent", () => {
  test("one form: role, name, number, the consent text, the privacy text in place, then Tidak setuju and Setuju", async () => {
    draw(page({ me: null, view: "form" }));
    expect(await screen.findByText(/Daftar nomor di perangkat ini tidak bisa dimuat/)).toBeTruthy();
    for (const name of ["role", "name", "number", "officerRegency", "officerPosition"])
      expect(document.querySelector(`[name="${name}"]`)).toBeTruthy();
    expect(screen.getByLabelText("WhatsApp").getAttribute("autocomplete")).toBe("tel-national");
    expect(screen.getByRole("button", { name: "Setuju" }).getAttribute("value")).toBe("readBack");
    expect(screen.getByRole("button", { name: "Tidak setuju" }).getAttribute("value")).toBe("decline");
    fireEvent.click(screen.getByText("Baca kebijakan privasi lengkap"));
    const close = await screen.findByRole("button", { name: "Tutup kebijakan privasi" });
    const details = close.closest("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent.click(close);
    expect(details.open).toBe(false);
  });

  test("an empty position for an officer is refused under it, tied to it, focused; the values stay", async () => {
    const refused: ErrorEnvelope = {
      ...SAMPLE_FIELD_ERROR,
      fields: [
        {
          fieldId: "officerPosition",
          copyKey: "fieldError.required",
          params: { label: "identity.officerPosition.label" },
        },
      ],
    };
    const values = {
      ...EMPTY,
      role: "claimedOfficer",
      name: "Uji Satu",
      number: "080000000001",
      officerRegency: "Kabupaten Contoh",
    };
    draw(page({ me: null, view: "form" }), acted({ envelope: refused, values }));
    const position = await screen.findByLabelText("Jabatan");
    await waitFor(() => expect(document.activeElement).toBe(position));
    expect(position.getAttribute("aria-invalid")).toBe("true");
    expect(position.getAttribute("aria-describedby")).toContain("officerPosition-error");
    expect(screen.getByText("Jabatan belum diisi. Isi Jabatan untuk melanjutkan.")).toBeTruthy();
    expect((screen.getByLabelText("BPBD") as HTMLInputElement).value).toBe("Kabupaten Contoh");
    expect((screen.getByLabelText("Petugas BPBD") as HTMLInputElement).checked).toBe(true);
  });

  test("a missing role ties its error to the radios; a service fault and a device limit are named", async () => {
    const refused: ErrorEnvelope = {
      ...SAMPLE_FIELD_ERROR,
      fields: [{ fieldId: "role", copyKey: "fieldError.required", params: { label: "identity.role.label" } }],
    };
    draw(page({ me: null, view: "form" }), acted({ envelope: refused }));
    expect((await screen.findByLabelText("Warga")).getAttribute("aria-invalid")).toBe("true");
    draw(
      page({ view: "form" }),
      acted({
        envelope: {
          ...SAMPLE_FIELD_ERROR,
          error: { code: "request.unavailable", copyKey: "error.request.unavailable", params: {} },
          fields: [],
        },
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain("Layanan sedang terganggu");
    const deviceLimit: ErrorEnvelope = {
      error: { code: "limit.device.numbers", copyKey: "limit.device.numbers", params: { limit: 5 } },
      fields: [],
      retryAt: null,
      draft: null,
    };
    draw(page({ view: "form" }), acted({ envelope: deviceLimit }));
    expect(
      await screen.findByText(
        "Perangkat ini sudah dipakai untuk terlalu banyak nomor. Gunakan perangkat Anda sendiri.",
      ),
    ).toBeTruthy();
  });

  test("a session asks no number and consents directly", async () => {
    draw(page({ me: { ...SAMPLE_ME, session: { kind: "reporter" } }, view: "form" }));
    expect(await screen.findByText("Anda sudah masuk. Nomor tidak perlu diisi lagi.")).toBeTruthy();
    expect(screen.queryByLabelText("WhatsApp")).toBeNull();
    expect(screen.getByRole("button", { name: "Setuju" }).getAttribute("value")).toBe("consent");
  });

  test("changing a known profile keeps its name and role and posts the change", async () => {
    draw(page({ view: "form", profileId: profile.profileId, editing: true }));
    expect(((await screen.findByLabelText("Nama")) as HTMLInputElement).value).toBe("Uji Satu");
    expect(screen.queryByRole("button", { name: "Tidak setuju" })).toBeNull();
    expect(screen.getByRole("button", { name: "Setuju" }).getAttribute("value")).toBe("useProfile");
    expect((document.querySelector('input[name="editProfile"]') as HTMLInputElement).value).toBe("1");
  });

  test("Setuju is busy while the form is on its way; a changed profile carries its id through", async () => {
    draw(page({ me: null, view: "form" }));
    fireEvent.click(await screen.findByRole("button", { name: "Setuju" }));
    await screen.findByRole("button", { name: "Menyimpan jawaban..." });
    draw(page(), acted({ view: "declineConfirm", profileId: profile.profileId, editing: true }));
    await screen.findByRole("heading", { name: "Tidak setuju?" });
    expect((document.querySelector('input[name="profileId"]') as HTMLInputElement).value).toBe(profile.profileId);
    expect(document.querySelector('input[name="editProfile"]')).toBeTruthy();
  });

  test("the number is read back before anything is stored, with Ganti then Ya", async () => {
    const values = { ...EMPTY, role: "citizen", name: "Uji Satu", number: "080000000001" };
    draw(page({ view: "form" }), acted({ view: "readBack", readBack: "+62 800 0000 0001", values }));
    expect(await screen.findByText("Nomor ini yang akan dicatat. Benar?")).toBeTruthy();
    expect(screen.getByText("+62 800 0000 0001")).toBeTruthy();
    expect((document.querySelector('input[name="number"]') as HTMLInputElement).value).toBe("080000000001");
    expect(screen.getByRole("button", { name: "Ganti" }).getAttribute("value")).toBe("changeNumber");
    fireEvent.click(screen.getByRole("button", { name: "Ya" }));
    await screen.findByRole("button", { name: "Menyimpan jawaban..." });
    draw(page({ view: "form" }), acted({ view: "readBack", values }));
    expect(await screen.findByText("Nomor ini yang akan dicatat. Benar?")).toBeTruthy();
  });

  test("a decline asks first and keeps every value for the way back; the decline itself shows 112", async () => {
    const values = { ...EMPTY, role: "citizen", name: "Uji Dua" };
    draw(page({ view: "form" }), acted({ view: "declineConfirm", values }));
    expect(await screen.findByRole("heading", { name: "Tidak setuju?" })).toBeTruthy();
    expect([...document.querySelectorAll<HTMLInputElement>('input[name="name"]')].map((input) => input.value)).toEqual([
      "Uji Dua",
      "Uji Dua",
    ]);
    draw(page({ view: "form" }), acted({ view: "declined" }));
    expect(await screen.findByRole("heading", { name: "Laporan tidak dibuat" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Telepon 112" })).toBeTruthy();
  });
});

describe("the home", () => {
  test("one way to report, the resume offer per open draft, and the contacts as links", async () => {
    renderPage(
      <>
        <HomeHero known={false} sent={false} />
        <HomeScreen
          me={{ ...SAMPLE_ME, knownReporters: [withDraft, { ...profile, profileId: "p-2", openDraft: null }] }}
        />
      </>,
      {
        path: "/lapor",
      },
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Laporkan kejadian bencana di sekitar Anda" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lapor kejadian" }).getAttribute("href")).toBe("/lapor/report");
    expect(screen.getByRole("link", { name: "112 Darurat terpadu" }).getAttribute("href")).toBe("tel:112");
    expect(screen.getByRole("link", { name: "Lihat cara melapor" }).getAttribute("href")).toBe("#steps");
    expect(screen.getByRole("heading", { level: 2, name: "Cara melapor" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Ada laporan yang belum selesai" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Buat laporan baru" }).getAttribute("href")).toBe(
      `/lapor/report?discard=${withDraft.profileId}`,
    );
    expect(screen.getByRole("link", { name: "021 2982 7793" }).getAttribute("href")).toBe("tel:02129827793");
    expect(screen.getByText(/Graha BNPB/).closest("a")).toBeNull();
  });

  test("Laporan saya lists each sent report with its stage and tracking link; Cek status laporan leads there", async () => {
    renderPage(
      <>
        <HomeHero known sent />
        <HomeScreen me={SAMPLE_ME} />
      </>,
      { path: "/lapor" },
    );
    const list = await screen.findByRole("region", { name: "Laporan saya" });
    expect(list.id).toBe("laporan-saya");
    expect(screen.getByRole("link", { name: "Cek status laporan" }).getAttribute("href")).toBe("#laporan-saya");
    expect(within(list).getByText("LA-231126-01")).toBeTruthy();
    expect(within(list).getByText("Banjir, dikirim 23 November 2026 pukul 09.00 WIB")).toBeTruthy();
    expect(within(list).getByText("Laporan diterima")).toBeTruthy();
    // The whole row is the link, so it is named by the ticket and its stage too.
    const row = within(list).getByRole("link", { name: /LA-231126-01.*Laporan diterima.*Buka laporan/ });
    expect(row.getAttribute("href")).toBe("/lapor/reports/LA-231126-01");
  });

  test("with nothing sent, Laporan saya says so and there is no Cek status laporan", async () => {
    renderPage(<HomeScreen me={{ ...SAMPLE_ME, reports: [] }} />, { path: "/lapor" });
    expect(await screen.findByText("Belum ada laporan terkirim dari perangkat ini.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Cek status laporan" })).toBeNull();
  });

  test("unreadable drafts are said, and reporting still works", async () => {
    renderPage(<HomeScreen me={null} />, { path: "/lapor" });
    expect(await screen.findByText(/tidak bisa dimuat sekarang/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Muat ulang daftar" })).toBeTruthy();
    expect(SAMPLE_DRAFTS.sent).toBeTruthy();
  });
});
