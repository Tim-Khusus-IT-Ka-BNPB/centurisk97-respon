import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { envelope } from "../../../../src/api/envelope";
import type { DeskIdentity } from "../../../../src/contract/desk";
import { REPORT, renderDesk, SENT, SUMMARY } from "../../../testing/desk";
import { never } from "../../../testing/render";

const drawn = vi.hoisted(() => ({ points: [] as readonly unknown[] }));
vi.mock("../DeskMapCanvas", () => ({
  SMALL: {},
  DeskMapCanvas: (props: { label: string; points: readonly unknown[] }) => {
    drawn.points = props.points;
    return <section aria-label={props.label} />;
  },
}));

import { DeskReportView } from "./DeskReport";

const PATH = { path: "/lapor/meja/LA-241126-01" };

describe("a report on the desk", () => {
  test("each version has its files, posted for as each download is logged; a refused one is told", async () => {
    const view = await renderDesk(<DeskReportView report={REPORT} summary={SUMMARY} />, PATH);
    const documents = within(screen.getByRole("region", { name: "Dokumen laporan" }));
    expect(documents.getByText("Setiap unduhan", { exact: false })).toBeTruthy();
    const pdf = documents.getByRole("button", { name: "Unduh PDF versi 2" }) as HTMLButtonElement;
    expect([pdf.name, pdf.value]).toEqual(["format", "pdf"]);
    expect(pdf.form?.getAttribute("action")).toBe("/lapor/meja/LA-241126-01/documents");
    expect(pdf.form?.getAttribute("method")).toBe("post");
    expect(new FormData(pdf.form as HTMLFormElement).get("version")).toBe("2");
    expect(documents.getByRole("button", { name: "Unduh Word versi 1" })).toBeTruthy();
    expect(documents.getByText(/Koreksi pengecekan lapangan/)).toBeTruthy();
    view.unmount();
    await renderDesk(<DeskReportView report={REPORT} summary={SUMMARY} />, {
      ...PATH,
      entry: `${PATH.path}?refused=document`,
    });
    expect(screen.getByRole("alert").textContent).toContain("Dokumen belum bisa diunduh.");
  });

  test("a claimed officer whose number the pilot list names is confirmed", async () => {
    const officer = { ...REPORT, reporter: { ...REPORT.reporter, role: "claimedOfficer" as const } };
    const view = await renderDesk(<DeskReportView report={officer} summary={SUMMARY} />, PATH);
    expect(screen.getAllByText("Petugas BPBD (belum dikonfirmasi)").length).toBeGreaterThan(0);
    view.unmount();
    await renderDesk(<DeskReportView report={{ ...officer, officerConfirmed: true }} summary={SUMMARY} />, PATH);
    expect(screen.getAllByText("Petugas BPBD (dikonfirmasi)").length).toBeGreaterThan(0);
    expect(screen.queryByText("Petugas BPBD (belum dikonfirmasi)")).toBeNull();
  });

  test("one that came through WhatsApp says so, and where its values were written", async () => {
    const chat = { ...REPORT, door: "chat" as const, numberUnverified: false };
    await renderDesk(<DeskReportView report={chat} summary={SUMMARY} />, PATH);
    const header = screen.getByRole("heading", { level: 1 }).closest("header") as HTMLElement;
    expect(within(header).getByText("Lewat WhatsApp")).toBeTruthy();
    expect(screen.getByText("Laporan ini dikirim dari WhatsApp nomor ini.")).toBeTruthy();
    expect(screen.getAllByText("Ditulis pelapor di chat").length).toBeGreaterThan(0);
    expect(screen.queryByText("Diisi pelapor di kotak isian")).toBeNull();
  });

  test("its point on a small map, or none where its village has no outline", async () => {
    const view = await renderDesk(<DeskReportView report={REPORT} summary={SUMMARY} />, PATH);
    expect(drawn.points).toEqual([REPORT.point]);
    view.unmount();
    const photo = {
      ticketNumber: "LA-241126-01",
      badge: "none" as const,
      far: false,
      takenAt: SENT,
      receivedAt: SENT,
      doubts: [],
    };
    const photos = ["1", "2"].map((n) => ({ ...photo, photoId: `${n}1111111-1111-4111-8111-111111111111` }));
    const many = await renderDesk(<DeskReportView report={{ ...REPORT, photos }} summary={SUMMARY} />, PATH);
    const shown = within(screen.getByRole("region", { name: "Foto pelapor" }));
    expect(shown.getAllByRole("img")).toHaveLength(2);
    // The photos are on their own report's page, so nothing leads to it.
    expect(shown.queryByRole("link", { name: "LA-241126-01" })).toBeNull();
    many.unmount();
    await renderDesk(<DeskReportView report={{ ...REPORT, point: null }} summary={SUMMARY} />, PATH);
    expect(screen.queryByRole("region", { name: /Titik laporan/ })).toBeNull();
  });

  test("its header, every value with where it came from, the reporter, the history and the reporter's answers", async () => {
    await renderDesk(<DeskReportView report={REPORT} summary={SUMMARY} />, PATH);
    const heading = screen.getByRole("heading", { level: 1, name: "LA-241126-01" });
    const header = within(heading.closest("header") as HTMLElement);
    expect(header.getByText("Dilihat")).toBeTruthy();
    expect(header.getByText("Nomor belum diverifikasi")).toBeTruthy();
    expect(screen.getByText("Desa/Kel. Sukamaju, Kec. Contoh, Aceh Utara")).toBeTruthy();
    // Every figure, known or not; the houses' is at least that many.
    const figures = [...(heading.closest("header") as HTMLElement).querySelectorAll("dl > div")];
    expect(figures.map((one) => [one.querySelector("dt")?.textContent, one.querySelector("dd")?.textContent])).toEqual([
      ["Meninggal", "2"],
      ["Hilang", "belum didata"],
      ["Luka-luka", "tidak ada"],
      ["Mengungsi", "belum didata"],
      ["Rumah rusak", "3+, Sebagian jenis kerusakan belum didata"],
    ]);
    expect(screen.getByRole("region", { name: "Titik laporan LA-241126-01" })).toBeTruthy();
    expect(screen.getByText("titik GPS")).toBeTruthy();
    const values = within(screen.getByRole("region", { name: "Isian laporan" }));
    expect(values.getByText("Lengkap 62 persen")).toBeTruthy();
    expect(values.getByText("Jenis bencana")).toBeTruthy();
    expect(values.getByText("Banjir")).toBeTruthy();
    expect(values.getByText("Dipilih pelapor")).toBeTruthy();
    expect(values.getByText("2 orang")).toBeTruthy();
    expect(values.getByText("dua orang meninggal")).toBeTruthy();
    expect(values.getByText("Diisi pelapor di kotak isian")).toBeTruthy();
    expect(values.getByText("tidak tahu")).toBeTruthy();
    expect(values.getByText("belum didata")).toBeTruthy();
    const reporter = within(screen.getByRole("region", { name: "Pelapor" }));
    expect(reporter.getByText("Petugas BPBD (belum dikonfirmasi)")).toBeTruthy();
    expect(reporter.getByText("Mengaku petugas BPBD Kabupaten Uji, jabatan Staf")).toBeTruthy();
    expect(reporter.getByRole("link", { name: "Telepon +62 800-0000-0001" }).getAttribute("href")).toBe(
      "tel:+6280000000001",
    );
    expect(reporter.getByText("Nomor ini diketik pelapor tanpa kode, jadi belum terbukti miliknya.")).toBeTruthy();
    const history = within(screen.getByRole("region", { name: "Riwayat tiket" }));
    expect(history.getByText("Sistem")).toBeTruthy();
    expect(history.getByText("Pusdalops BNPB, Petugas Uji")).toBeTruthy();
    expect(history.getByText("Dicek")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Jawaban pelapor" })).getByText("banjir, dua orang meninggal"),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Foto pelapor" })).getByText("Pelapor tidak mengirim foto."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tandai sudah dilihat" })).toBeNull();
    // On a report page no view or queue is the current one.
    const menu = within(screen.getAllByRole("navigation", { name: "Antrean kerja" })[0] as HTMLElement);
    expect(menu.getAllByRole("link").every((link) => link.getAttribute("aria-current") === null)).toBe(true);
  });

  test("a verified citizen with no answers of their own, and the reporter's photos", async () => {
    const photo = {
      photoId: "11111111-1111-4111-8111-111111111111",
      ticketNumber: "LA-241126-01",
      badge: "photoData" as const,
      far: false,
      takenAt: SENT,
      receivedAt: SENT,
      doubts: [],
    };
    await renderDesk(
      <DeskReportView
        report={{
          ...REPORT,
          numberUnverified: false,
          reporterWords: [],
          photos: [photo],
          reporter: {
            role: "citizen",
            identity: { ...(REPORT.reporter.identity as DeskIdentity), officerRegency: null, officerPosition: null },
          },
        }}
        summary={null}
      />,
      PATH,
    );
    expect(screen.queryByText("Nomor belum diverifikasi")).toBeNull();
    expect(screen.getByText("Belum ada jawaban pelapor yang tercatat.")).toBeTruthy();
    const photos = within(screen.getByRole("region", { name: "Foto pelapor" }));
    expect(photos.getByRole("img", { name: "Foto laporan LA-241126-01" })).toBeTruthy();
    expect(photos.getByText("Lokasi dari data foto")).toBeTruthy();
  });

  test("opening a new report posts the open once, and offers the button for a page with no script", async () => {
    const posted = vi.fn(() => null);
    await renderDesk(<DeskReportView report={{ ...REPORT, status: "new" }} summary={SUMMARY} />, {
      ...PATH,
      action: posted,
    });
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Tandai sudah dilihat" })).toBeTruthy();
  });

  test("an open on its way shows the button busy", async () => {
    await renderDesk(<DeskReportView report={{ ...REPORT, status: "new" }} summary={SUMMARY} />, {
      ...PATH,
      action: never,
    });
    expect(await screen.findByRole("button", { name: "Menyimpan..." })).toBeTruthy();
  });

  test("a refused open says why: a limit names its time, anything else its fix", async () => {
    const limited = {
      ...envelope("limit.desk.write", { params: { limit: 120 } }),
      retryAt: { utc: "2099-01-01T00:00:00.000Z", zone: "WIB" as const },
    };
    const view = await renderDesk(<DeskReportView report={REPORT} summary={SUMMARY} refusal={limited} />, PATH);
    expect(screen.getByText(/paling banyak 120 tindakan per jam/)).toBeTruthy();
    view.unmount();
    const barred = await renderDesk(
      <DeskReportView report={REPORT} summary={SUMMARY} refusal={envelope("desk.notAllowed")} />,
      PATH,
    );
    expect(screen.getByRole("alert").textContent).toContain("belum berhak");
    barred.unmount();
    // Posted beside the page, it is told the same.
    const action = () => ({ envelope: limited });
    await renderDesk(<DeskReportView report={REPORT} summary={SUMMARY} />, { ...PATH, action });
    expect(await screen.findByText(/paling banyak 120 tindakan per jam/)).toBeTruthy();
  });

  test("a change kept says so once, with where the ticket is now", async () => {
    const saved = (entry: string) =>
      renderDesk(<DeskReportView report={REPORT} summary={SUMMARY} />, { ...PATH, entry: `${PATH.path}${entry}` });
    const moved = await saved("?saved=status");
    expect(screen.getByRole("status").textContent).toBe("Status tersimpan. Tiket sekarang: Sudah dilihat petugas.");
    moved.unmount();
    // Opening the report is posted beside the page: once answered, what was just done is still told.
    const opened = vi.fn(() => null);
    const kept = await renderDesk(<DeskReportView report={REPORT} summary={SUMMARY} />, {
      ...PATH,
      entry: `${PATH.path}?saved=status`,
      action: opened,
    });
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(screen.getByRole("status").textContent).toContain("Status tersimpan.");
    kept.unmount();
    const replied = await saved("?saved=replies");
    expect(screen.getByRole("status").textContent).toBe("Balasan terkirim. Status tiket: Sudah dilihat petugas.");
    replied.unmount();
    await saved("?saved=nope");
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("a change another officer got in before says what the ticket became, and nothing as saved", async () => {
    await renderDesk(
      <DeskReportView
        report={REPORT}
        summary={SUMMARY}
        refusal={envelope("ticket.changed", { params: { status: "stage.short.closed" } })}
      />,
      { ...PATH, entry: `${PATH.path}?saved=status` },
    );
    expect(screen.getByRole("alert").textContent).toContain("mengubah tiket ini menjadi Selesai");
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("a refusal on a field is told there, not above the report", async () => {
    await renderDesk(
      <DeskReportView
        report={REPORT}
        summary={SUMMARY}
        refusal={{
          ...envelope("request.invalidFields"),
          fields: [
            {
              fieldId: "note",
              copyKey: "fieldError.staffText.tooShort",
              params: { label: "desk.move.note.reason", min: 5 },
            },
          ],
        }}
        typed={{ values: { to: "invalid", note: "dup" }, actions: [] }}
      />,
      PATH,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    const actions = within(screen.getByRole("region", { name: "Tindak lanjut" }));
    expect(actions.getByText(/Alasan untuk pelapor terlalu pendek/)).toBeTruthy();
  });

  test("an account that must ask for identity sees none, is told it is logged, and asks with a button", async () => {
    const hidden = { ...REPORT, reporter: { role: "citizen" as const, identity: null } };
    const posted = vi.fn(never);
    const view = await renderDesk(<DeskReportView report={hidden} summary={SUMMARY} />, { ...PATH, action: posted });
    const reporter = within(screen.getByRole("region", { name: "Pelapor" }));
    expect(reporter.queryByRole("link")).toBeNull();
    expect(reporter.getByText("Warga")).toBeTruthy();
    expect(reporter.getByText(/akun Anda dan waktunya dicatat/)).toBeTruthy();
    reporter.getByRole("button", { name: "Tampilkan identitas pelapor" }).click();
    expect(await reporter.findByRole("button", { name: "Membuka..." })).toBeTruthy();
    view.unmount();
    await renderDesk(<DeskReportView report={hidden} summary={SUMMARY} identity={REPORT.reporter.identity} />, PATH);
    expect(screen.getByRole("link", { name: "Telepon +62 800-0000-0001" })).toBeTruthy();
  });

  test("an emergency is marked in its header", async () => {
    const emergency = { kind: "chat" as const, victims: "no" as const };
    await renderDesk(<DeskReportView report={{ ...REPORT, emergency }} summary={SUMMARY} />, PATH);
    const header = within(screen.getByRole("heading", { level: 1 }).closest("header") as HTMLElement);
    expect(header.getByText("Darurat")).toBeTruthy();
    expect(header.getByText("tidak ada korban")).toBeTruthy();
  });

  test("the history names the regency a report was forwarded to", async () => {
    const history = [
      ...REPORT.history,
      {
        status: "forwarded" as const,
        at: SENT,
        actor: "Petugas Uji",
        note: null,
        forwardedTo: "Aceh Utara",
        event: null,
        detail: null,
      },
    ];
    await renderDesk(<DeskReportView report={{ ...REPORT, history }} summary={SUMMARY} />, PATH);
    expect(
      within(screen.getByRole("region", { name: "Riwayat tiket" })).getByText("Diteruskan ke meja BPBD Aceh Utara"),
    ).toBeTruthy();
  });

  test("the reporter's news stands out until acted on, and its history row tells what it changed", async () => {
    const change = {
      fieldId: "displacedPeople",
      from: null,
      to: {
        fieldId: "displacedPeople",
        state: "value" as const,
        value: { kind: "count" as const, count: 30 },
        origin: "quote" as const,
      },
    };
    const versions = [{ version: 2, at: SENT, madeBy: "reporter" as const, changes: [change] }];
    const history = [
      ...REPORT.history,
      {
        status: "seen" as const,
        at: { ...SENT, utc: "2026-11-24T05:00:00.000Z" },
        actor: null,
        note: null,
        forwardedTo: null,
        event: "followUp" as const,
        detail: { version: 2 },
      },
    ];
    const report = { ...REPORT, news: true, versions, history };
    const view = await renderDesk(<DeskReportView report={report} summary={SUMMARY} />, PATH);
    const news = within(screen.getByRole("region", { name: "Kabar baru dari pelapor, versi 2" }));
    expect(news.getByRole("listitem").textContent).toBe("Mengungsi: belum didata menjadi 30 orang");
    expect(screen.getByText("Kabar baru")).toBeTruthy();
    const told = within(screen.getByRole("region", { name: "Riwayat tiket" }));
    expect(told.getByText("Kabar tambahan, versi 2")).toBeTruthy();
    expect(told.getByText("Pelapor")).toBeTruthy();
    expect(told.getByText("30 orang")).toBeTruthy();
    view.unmount();
    // Photos alone are news too; news with no version of its own draws nothing.
    const photos = { ...report, versions: [{ ...(versions[0] as (typeof versions)[0]), changes: [] }] };
    const second = await renderDesk(<DeskReportView report={photos} summary={SUMMARY} />, PATH);
    expect(screen.getByText("Pelapor menambah foto. Tidak ada isian yang berubah.")).toBeTruthy();
    second.unmount();
    await renderDesk(<DeskReportView report={{ ...report, versions: [] }} summary={SUMMARY} />, PATH);
    expect(screen.queryByRole("region", { name: /Kabar baru dari pelapor/ })).toBeNull();
  });

  test("work is told in the history, and what was done is shown with its photos", async () => {
    const event = { at: SENT, actor: "Petugas Uji", forwardedTo: null, status: "in_handling" as const };
    await renderDesk(
      <DeskReportView
        report={{
          ...REPORT,
          status: "in_handling",
          history: [
            ...REPORT.history,
            { ...event, note: null, event: "actions", detail: { actions: ["Evakuasi warga", "Sedot sumur"] } },
            {
              ...event,
              note: "Dicek ke kepala desa",
              event: "fieldCheck",
              detail: {
                result: "partly",
                changes: [
                  { fieldId: "dead", from: 3, to: 2 },
                  { fieldId: "injured", from: null, to: 1 },
                ],
              },
            },
          ],
          actions: [{ label: "Evakuasi warga", at: SENT, actor: "Petugas Uji" }],
          proofs: [
            { proofId: "p1", hasPoint: true, at: SENT, actor: "Petugas Uji", public: false },
            { proofId: "p2", hasPoint: false, at: SENT, actor: "Petugas Uji", public: false },
          ],
        }}
        summary={SUMMARY}
      />,
      PATH,
    );
    const history = within(screen.getByRole("region", { name: "Riwayat tiket" }));
    expect(history.getByText("Tindakan dicatat")).toBeTruthy();
    expect(history.getByText("Evakuasi warga, Sedot sumur")).toBeTruthy();
    expect(history.getByText("Pengecekan lapangan: Sebagian benar")).toBeTruthy();
    expect(history.getByText("Meninggal: 3 menjadi 2")).toBeTruthy();
    expect(history.getByText("Luka-luka: belum didata menjadi 1")).toBeTruthy();
    const handling = within(screen.getByRole("region", { name: "Penanganan" }));
    expect(handling.getByText("Evakuasi warga")).toBeTruthy();
    expect(handling.getByRole("img", { name: "Foto penanganan 1" }).getAttribute("src")).toBe(
      "/api/lapor/desk/proofs/p1",
    );
    expect(handling.getByText("Titik GPS petugas tersimpan")).toBeTruthy();
    expect(handling.getByText("Tanpa titik GPS")).toBeTruthy();
  });

  test("photos with no action told, and actions with no photo, are each shown alone", async () => {
    const proofs = [{ proofId: "p1", hasPoint: true, at: SENT, actor: "Petugas Uji", public: false }];
    const view = await renderDesk(<DeskReportView report={{ ...REPORT, proofs }} summary={SUMMARY} />, PATH);
    expect(within(screen.getByRole("region", { name: "Penanganan" })).getAllByRole("img")).toHaveLength(1);
    view.unmount();
    const actions = [{ label: "Evakuasi warga", at: SENT, actor: "Petugas Uji" }];
    const other = await renderDesk(<DeskReportView report={{ ...REPORT, actions }} summary={SUMMARY} />, PATH);
    expect(within(screen.getByRole("region", { name: "Penanganan" })).queryByRole("img")).toBeNull();
    other.unmount();
    await renderDesk(<DeskReportView report={REPORT} summary={SUMMARY} />, PATH);
    expect(screen.queryByRole("region", { name: "Penanganan" })).toBeNull();
  });

  test("a report kept on a phone with no signal is marked; sent late it is not an emergency", async () => {
    const emergency = { kind: "oneTap" as const, victims: "yes" as const };
    await renderDesk(
      <DeskReportView report={{ ...REPORT, emergency, offline: { savedAt: null, late: true } }} summary={SUMMARY} />,
      PATH,
    );
    expect(screen.getByText("Dikirim terlambat")).toBeTruthy();
    expect(screen.queryByText("Darurat")).toBeNull();
  });

  test("a report a week in one status says so beside its status", async () => {
    await renderDesk(<DeskReportView report={{ ...REPORT, overdue: true }} summary={SUMMARY} />, PATH);
    expect(screen.getByText("Lewat seminggu").getAttribute("title")).toBe("Sudah lebih dari seminggu di status ini");
  });

  test("BNPB sees who at the BPBD to call", async () => {
    const officers = {
      items: [
        {
          profileId: "profile-a",
          name: "Uji Andi",
          position: "Pusdalops",
          agency: "BPBD Kabupaten Uji Satu",
          level: "regency" as const,
          masked: "0800****8001",
        },
      ],
      official: null,
    };
    await renderDesk(
      <DeskReportView
        report={{ ...REPORT, officers }}
        summary={SUMMARY}
        officer={{ profileId: "profile-a", number: "+628001108001" }}
      />,
      PATH,
    );
    const section = screen.getByRole("region", { name: "PIC BPBD setempat" });
    expect(within(section).getByRole("link", { name: "Telepon" }).getAttribute("href")).toBe("tel:+628001108001");
  });

  test("a report in a cluster names it beside its status and links the others, itself marked", async () => {
    const cluster = {
      tickets: ["LA-241126-01", "LA-241126-02", "LA-241126-03"],
      reporters: 3,
      strong: true,
      sameVillage: false,
    };
    await renderDesk(<DeskReportView report={{ ...REPORT, cluster }} summary={SUMMARY} />, PATH);
    expect(screen.getByText("Gugus kuat, 3 laporan")).toBeTruthy();
    const section = screen.getByRole("region", { name: "Gugus laporan" });
    expect(within(section).getByText(/dari 3 nomor berbeda. Gugus bukan tanda terverifikasi/)).toBeTruthy();
    expect(
      within(section)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/lapor/meja/LA-241126-02", "/lapor/meja/LA-241126-03"]);
    expect(within(section).getByText("LA-241126-01").getAttribute("aria-current")).toBe("page");
  });

  test("an event its reporters confirmed shows by its code; BNPB may take this report out, and the history tells it", async () => {
    const event = { code: "KJ-241126-01", tickets: ["LA-241126-01", "LA-241126-02"], mayRelease: true };
    const history = [
      ...REPORT.history,
      {
        status: REPORT.status,
        at: SENT,
        actor: "Pusdalops BNPB, Petugas Uji",
        note: null,
        forwardedTo: null,
        event: "released" as const,
        detail: { code: "KJ-241126-01" },
      },
    ];
    const view = await renderDesk(<DeskReportView report={{ ...REPORT, event, history }} summary={SUMMARY} />, {
      ...PATH,
      entry: "/lapor/meja/LA-241126-01?saved=released",
    });
    const section = screen.getByRole("region", { name: "Kejadian KJ-241126-01" });
    expect(within(section).getByText(/^Pelapor menyatakan 2 laporan ini satu kejadian/)).toBeTruthy();
    expect(within(section).getByRole("link", { name: "LA-241126-01" }).getAttribute("aria-current")).toBe("page");
    const button = within(section).getByRole("button", { name: "Lepaskan laporan ini dari kejadian" });
    expect(((button.closest("form") as HTMLFormElement).elements.namedItem("action") as HTMLInputElement).value).toBe(
      "release",
    );
    expect(screen.getByText("Laporan ini dilepas dari kejadiannya.")).toBeTruthy();
    expect(screen.getByText("Dilepas dari kejadian KJ-241126-01")).toBeTruthy();
    view.unmount();
    await renderDesk(
      <DeskReportView report={{ ...REPORT, event: { ...event, mayRelease: false } }} summary={SUMMARY} />,
      PATH,
    );
    expect(screen.queryByRole("button", { name: "Lepaskan laporan ini dari kejadian" })).toBeNull();
  });

  test("the reporter's videos play from the desk's own address, each with its length", async () => {
    const videos = [
      { id: "33333333-3333-4333-8333-333333333333", seconds: 12, container: "mp4" },
      { id: "44444444-4444-4444-8444-444444444444", seconds: 60, container: "webm" },
    ];
    const view = await renderDesk(<DeskReportView report={{ ...REPORT, videos }} summary={SUMMARY} />, PATH);
    const section = screen.getByRole("region", { name: "Video dari pelapor" });
    const players = section.querySelectorAll("video");
    expect([...players].map((player) => [player.getAttribute("src"), player.controls])).toEqual([
      [`/api/lapor/desk/reports/LA-241126-01/videos/${videos[0]?.id}`, true],
      [`/api/lapor/desk/reports/LA-241126-01/videos/${videos[1]?.id}`, true],
    ]);
    expect(within(section).getByText("Video 2, 60 detik, tanpa keterangan lokasi")).toBeTruthy();
    view.unmount();
    await renderDesk(<DeskReportView report={REPORT} summary={SUMMARY} />, PATH);
    expect(screen.queryByRole("region", { name: "Video dari pelapor" })).toBeNull();
  });

  test("each photo of the work is shown on the Alun-alun or taken off it by its own button", async () => {
    const proofs = [
      { proofId: "p1", hasPoint: true, at: SENT, actor: "Petugas Uji", public: true },
      { proofId: "p2", hasPoint: false, at: SENT, actor: "Petugas Uji", public: false },
    ];
    const view = await renderDesk(<DeskReportView report={{ ...REPORT, proofs }} summary={SUMMARY} />, PATH);
    const handling = screen.getByRole("region", { name: "Penanganan" });
    expect(within(handling).getByText(/^Foto yang ditampilkan bisa dilihat siapa saja/)).toBeTruthy();
    expect(within(handling).getAllByText("Tampil di Alun-alun")).toHaveLength(1);
    const hide = within(handling).getByRole("button", { name: "Sembunyikan foto penanganan 1 dari Alun-alun" });
    const form = hide.closest("form") as HTMLFormElement;
    expect(Object.fromEntries(new FormData(form))).toEqual({ action: "proofPublic", proofId: "p1", public: "0" });
    const show = within(handling).getByRole("button", { name: "Tampilkan foto penanganan 2 di Alun-alun" });
    expect(show.textContent).toBe("Tampilkan di Alun-alun");
    expect(new FormData(show.closest("form") as HTMLFormElement).get("public")).toBe("1");
    view.unmount();
    await renderDesk(<DeskReportView report={REPORT} summary={SUMMARY} />, {
      ...PATH,
      entry: `${PATH.path}?saved=proofShown`,
    });
    expect(screen.getByRole("status").textContent).toBe("Foto tampil di Alun-alun.");
  });

  test("who has a report in hand is named; an officer who may take it is told it is for good", async () => {
    const view = await renderDesk(<DeskReportView report={{ ...REPORT, mayTake: true }} summary={SUMMARY} />, {
      ...PATH,
      action: never,
    });
    expect(screen.queryByText(/^Ditangani/)).toBeNull();
    expect(screen.getByText(/Tidak bisa dipindah ke petugas lain/)).toBeTruthy();
    screen.getByRole("button", { name: "Ambil laporan" }).click();
    expect(await screen.findByRole("button", { name: "Menyimpan..." })).toBeTruthy();
    view.unmount();
    const taker = "Uji Andi, Pusdalops BPBD Kabupaten Uji Satu";
    const history = [
      ...REPORT.history,
      {
        status: "seen" as const,
        at: SENT,
        actor: "BPBD",
        note: null,
        forwardedTo: null,
        event: "take" as const,
        detail: { taker },
      },
    ];
    await renderDesk(<DeskReportView report={{ ...REPORT, taker, history }} summary={SUMMARY} />, {
      ...PATH,
      entry: `${PATH.path}?saved=take`,
    });
    expect(screen.getAllByText(`Ditangani: ${taker}`)).toHaveLength(2);
    expect(screen.getByRole("status").textContent).toBe("Laporan ini sekarang Anda tangani.");
    expect(screen.queryByRole("button", { name: "Ambil laporan" })).toBeNull();
  });
});
