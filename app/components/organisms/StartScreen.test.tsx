import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import { SAMPLE_DRAFTS, SAMPLE_FIELD_ERROR, SAMPLE_ME } from "../../../src/testing/samples";
import type { StartActionData, StartPageData } from "../../lib/startTypes";
import { ALL_TEXTS, never, renderPage } from "../../testing/render";
import { HomeHero } from "./HomeHero";
import { HomeScreen } from "./HomeScreen";
import { StartHeading, StartScreen } from "./StartScreen";

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
  renderPage(<StartScreen page={data} acted={action} />, { path: "/report", action: never });

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
      `/report/${withDraft.openDraft.draftId}`,
    );
    expect(screen.getByRole("link", { name: "Nomor lain" }).getAttribute("href")).toContain("?new=1");
  });

  test("an emergency stays one through every step", async () => {
    renderPage(<StartScreen page={page({ emergency: true })} acted={null} />, {
      path: "/report",
      entry: "/report?emergency=1",
      action: never,
    });
    const hrefs = (await screen.findAllByRole("link")).map((link) => link.getAttribute("href"));
    expect(hrefs).toContain(`/report?profile=${profile.profileId}&emergency=1`);
    expect(hrefs).toContain("/report?new=1&emergency=1");
  });

  test("the way back to a missing person's report stays through every step", async () => {
    renderPage(<StartScreen page={page()} acted={null} />, {
      path: "/report",
      entry: "/report?missing=1",
      action: never,
    });
    const hrefs = (await screen.findAllByRole("link")).map((link) => link.getAttribute("href"));
    expect(hrefs).toContain(`/report?profile=${profile.profileId}&missing=1`);
  });

  test("a poster's village stays through every step; a desa of the wrong shape is dropped", async () => {
    const view = renderPage(<StartScreen page={page()} acted={null} />, {
      path: "/report",
      entry: "/report?village=1108012005",
      action: never,
    });
    const hrefs = (await screen.findAllByRole("link")).map((link) => link.getAttribute("href"));
    expect(hrefs).toContain(`/report?profile=${profile.profileId}&village=1108012005`);
    expect(hrefs).toContain("/report?new=1&village=1108012005");
    view.unmount();
    renderPage(<StartScreen page={page()} acted={null} />, {
      path: "/report",
      entry: "/report?village=11.08",
      action: never,
    });
    const plain = (await screen.findAllByRole("link")).map((link) => link.getAttribute("href"));
    expect(plain).toContain("/report?new=1");
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
    expect(screen.getByLabelText("Nomor HP").getAttribute("autocomplete")).toBe("tel-national");
    // A new reporter is greeted by Sigap, starts as a resident, and types the number after the +62 shown.
    expect(screen.getByText("Halo, saya Sigap")).toBeTruthy();
    expect((screen.getByLabelText("Warga") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Petugas BPBD") as HTMLInputElement).checked).toBe(false);
    const number = screen.getByLabelText("Nomor HP");
    expect([number.getAttribute("placeholder"), number.getAttribute("inputmode")]).toEqual(["8xx xxxx xxxx", "tel"]);
    expect(number.getAttribute("aria-describedby")).toBe("number-prefix");
    expect(document.getElementById("number-prefix")?.textContent).toBe("+62");
    expect(screen.getByLabelText("Nama").getAttribute("placeholder")).toBe("Nama lengkap");
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

  test("a refused number keeps the +62 in what describes it, with its error after", async () => {
    const refused: ErrorEnvelope = {
      ...SAMPLE_FIELD_ERROR,
      fields: [{ fieldId: "number", copyKey: "fieldError.required", params: { label: "identity.number.label" } }],
    };
    draw(page({ me: null, view: "form" }), acted({ envelope: refused, values: { ...EMPTY, role: "citizen" } }));
    const number = await screen.findByLabelText("Nomor HP");
    expect(number.getAttribute("aria-describedby")).toBe("number-prefix number-error");
    // The officer's fields keep their example as a hint.
    expect(screen.getByLabelText("BPBD").getAttribute("aria-describedby")).toBe("officerRegency-hint");
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
    expect(screen.queryByLabelText("Nomor HP")).toBeNull();
    expect(screen.getByRole("button", { name: "Setuju" }).getAttribute("value")).toBe("consent");
  });

  test("a desk session is told it cannot report and given the way out back here", async () => {
    draw(page({ me: { ...SAMPLE_ME, knownReporters: [], session: { kind: "staff" } }, view: "form" }));
    expect(await screen.findByRole("heading", { name: "Anda masuk sebagai petugas meja" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Setuju" })).toBeNull();
    const out = screen.getByRole("button", { name: "Keluar dari meja dan lapor" }).closest("form") as HTMLFormElement;
    expect(out.getAttribute("action")).toBe("/desk");
    expect((out.querySelector('input[name="next"]') as HTMLInputElement).value).toBe("/report");
    expect(screen.getByRole("link", { name: "Kembali ke meja" }).getAttribute("href")).toBe("/desk");
  });

  test("changing a known profile keeps its name and role and posts the change", async () => {
    draw(page({ view: "form", profileId: profile.profileId, editing: true }));
    expect(((await screen.findByLabelText("Nama")) as HTMLInputElement).value).toBe("Uji Satu");
    expect(screen.queryByText("Halo, saya Sigap")).toBeNull();
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

describe("the start's heading", () => {
  test("names the page for a screen reader and, on a phone, shows the first of six steps", async () => {
    const view = renderPage(<StartHeading />, { path: "/report" });
    expect(await screen.findByRole("heading", { level: 1, name: "Lapor kejadian" })).toBeTruthy();
    expect(screen.getByText("Langkah 1 dari 6: Kenalkan diri").closest("div")?.className).toContain("lg:hidden");
    const bars = [...view.container.querySelectorAll("ol li")];
    expect(bars.map((bar) => bar.className.includes("bg-primary"))).toEqual([true, false, false, false, false, false]);
  });
});

describe("the home", () => {
  test("one way to report, the resume offer per open draft, and the contacts as links", async () => {
    renderPage(
      <>
        <HomeHero sent={false} />
        <HomeScreen
          me={{ ...SAMPLE_ME, knownReporters: [withDraft, { ...profile, profileId: "p-2", openDraft: null }] }}
        />
      </>,
      {
        path: "/",
      },
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Ada bencana di sekitar Anda?" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lapor kejadian" }).getAttribute("href")).toBe("/report");
    expect(screen.getByRole("link", { name: "112 Darurat terpadu" }).getAttribute("href")).toBe("tel:112");
    expect(screen.getByRole("link", { name: "Lapor darurat" }).getAttribute("href")).toBe("/report?emergency=1");
    expect(screen.getByRole("link", { name: "Lapor orang hilang" }).getAttribute("href")).toBe("/missing");
    expect(screen.getByRole("link", { name: "117 Call center BNPB" }).getAttribute("href")).toBe("tel:117");
    expect(screen.getByRole("link", { name: "Lihat cara kerjanya" }).getAttribute("href")).toBe("#steps");
    expect(screen.getByRole("heading", { level: 2, name: "Cara kerjanya" })).toBeTruthy();
    // The example conversation is named as one, and shows what Sigap notes of words in Javanese.
    const demo = within(screen.getByRole("figure", { name: "Contoh" }));
    expect(demo.getByText("Banyu wis tekan dengkul, 20 omah kebanjiran.").getAttribute("lang")).toBe("jv");
    expect(demo.getByText("20 rumah terendam")).toBeTruthy();
    expect(demo.getByText("Tinggi air: Selutut")).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Ada laporan yang belum selesai" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Buat laporan baru" }).getAttribute("href")).toBe(
      `/report?discard=${withDraft.profileId}`,
    );
    expect(screen.getByRole("link", { name: "021 2982 7793" }).getAttribute("href")).toBe("tel:02129827793");
    expect(screen.getByText(/Graha BNPB/).closest("a")).toBeNull();
    // The other services sit on credited photos, each a small file for a phone and a larger one wider.
    const more = within(screen.getByRole("navigation", { name: "Layanan lain" }));
    expect(
      more
        .getAllByRole("link")
        .map((link) => [link.getAttribute("href"), link.querySelector("img")?.getAttribute("srcset")]),
    ).toEqual([
      ["/info", "/photos/cyclone-seroja-480.webp 480w, /photos/cyclone-seroja-960.webp 960w"],
      ["/help#help-education", "/photos/flooded-houses-480.webp 480w, /photos/flooded-houses-960.webp 960w"],
      ["/numbers", "/photos/peat-firefighter-480.webp 480w, /photos/peat-firefighter-960.webp 960w"],
    ]);
    expect(more.getByRole("link", { name: "Info daerah" }).querySelector("img")?.getAttribute("loading")).toBe("lazy");
    expect(more.getByText("Foto: NASA, LANCE / MODIS on Aqua, domain publik")).toBeTruthy();
    expect(more.getByText("Foto: DenY Krisbiyantoro, CC BY-SA 4.0")).toBeTruthy();
  });

  test("news not sent yet is offered as news, and a new report over it says only the news goes", async () => {
    const open = { ...(withDraft.openDraft as NonNullable<typeof withDraft.openDraft>), followUpOf: "LA-231126-01" };
    const me = { ...SAMPLE_ME, knownReporters: [{ ...withDraft, openDraft: open }] };
    const view = renderPage(<HomeScreen me={me} />, { path: "/" });
    expect(await screen.findByRole("heading", { name: "Kabar belum dikirim" })).toBeTruthy();
    expect(screen.getByText(/^Kabar untuk LA-231126-01, terakhir diisi pukul/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lanjutkan kabar" }).getAttribute("href")).toBe(`/report/${open.draftId}`);
    view.unmount();
    draw(page({ me, view: "discardConfirm", profileId: withDraft.profileId }), null);
    expect(
      await screen.findByText(
        "Kabar untuk LA-231126-01 yang belum dikirim akan dihapus. Laporan itu sendiri tidak berubah.",
      ),
    ).toBeTruthy();
  });

  test("Laporan saya lists each sent report with its stage and tracking link; Cek status laporan leads there", async () => {
    renderPage(
      <>
        <HomeHero sent />
        <HomeScreen me={SAMPLE_ME} />
      </>,
      { path: "/" },
    );
    const list = await screen.findByRole("region", { name: "Laporan saya" });
    expect(list.id).toBe("my-reports");
    expect(screen.getByRole("link", { name: "Cek status laporan" }).getAttribute("href")).toBe("#my-reports");
    expect(within(list).getByText("LA-231126-01")).toBeTruthy();
    expect(within(list).getByText("Banjir, dikirim 23 November 2026 pukul 09.00 WIB")).toBeTruthy();
    expect(within(list).getByText("Laporan diterima")).toBeTruthy();
    expect(within(list).getByText("2 kabar baru")).toBeTruthy();
    // The whole row is the link, so it is named by the ticket and its stage too.
    const row = within(list).getByRole("link", { name: /LA-231126-01.*Laporan diterima.*Buka laporan/ });
    expect(row.getAttribute("href")).toBe("/reports/LA-231126-01");
  });

  test("a report with no unread news carries no mark", async () => {
    const read = SAMPLE_ME.reports.map((report) => ({ ...report, unread: 0 }));
    renderPage(<HomeScreen me={{ ...SAMPLE_ME, reports: read }} />, { path: "/" });
    const list = await screen.findByRole("region", { name: "Laporan saya" });
    expect(within(list).getByText("LA-231126-01")).toBeTruthy();
    expect(within(list).queryByText(/kabar baru/)).toBeNull();
  });

  test("Laporan saya counts what was sent, in hand and finished, and lists missing persons reported", async () => {
    const reports = [
      ...SAMPLE_ME.reports,
      {
        ...(SAMPLE_ME.reports[0] as (typeof SAMPLE_ME.reports)[number]),
        ticketNumber: "LA-231126-02",
        status: "closed" as const,
      },
    ];
    const missing = [
      {
        id: "m1",
        name: "Uji Hilang",
        status: "open" as const,
        villageName: "Uji",
        createdAt: "2026-11-26T03:00:00.000Z",
      },
      { id: "m2", name: null, status: "closed" as const, villageName: "Dua", createdAt: "2026-11-25T03:00:00.000Z" },
    ];
    renderPage(<HomeScreen me={{ ...SAMPLE_ME, reports }} missing={missing} />, { path: "/" });
    const list = await screen.findByRole("region", { name: "Laporan saya" });
    const tiles = [...list.querySelectorAll("dl > div")].map((tile) => tile.textContent);
    expect(tiles).toEqual([`Terkirim${reports.length}`, `Diproses${reports.length - 1}`, "Selesai1"]);
    const sought = within(screen.getByRole("region", { name: "Orang hilang yang Anda laporkan" }));
    expect(sought.getByText("Uji Hilang, terakhir terlihat di Uji")).toBeTruthy();
    expect(sought.getByText("Nama sudah dihapus, terakhir terlihat di Dua")).toBeTruthy();
    expect(sought.getAllByRole("link")[0]?.getAttribute("href")).toBe("/missing");
  });

  test("a missing person reported is enough for Laporan saya, with no report tiles", async () => {
    const missing = [
      {
        id: "m1",
        name: "Uji Hilang",
        status: "open" as const,
        villageName: "Uji",
        createdAt: "2026-11-26T03:00:00.000Z",
      },
    ];
    renderPage(<HomeScreen me={{ ...SAMPLE_ME, reports: [] }} missing={missing} />, { path: "/" });
    const list = await screen.findByRole("region", { name: "Laporan saya" });
    expect(list.querySelector("dl")).toBeNull();
    expect(within(list).getByText("Uji Hilang, terakhir terlihat di Uji")).toBeTruthy();
  });

  test("with nothing sent, there is no Laporan saya and no Cek status laporan", async () => {
    renderPage(<HomeScreen me={{ ...SAMPLE_ME, reports: [] }} />, { path: "/" });
    expect(await screen.findByRole("heading", { name: "Cara kerjanya" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Laporan saya" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Cek status laporan" })).toBeNull();
  });

  test("unreadable drafts are said, and reporting still works", async () => {
    renderPage(<HomeScreen me={null} />, { path: "/" });
    expect(await screen.findByText(/tidak bisa dimuat sekarang/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Muat ulang daftar" })).toBeTruthy();
    expect(SAMPLE_DRAFTS.sent).toBeTruthy();
  });
});
