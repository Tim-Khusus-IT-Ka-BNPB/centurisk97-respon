import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { envelope } from "../../../../src/api/envelope";
import { REPORT, renderDesk, SENT, SUMMARY } from "../../../testing/desk";
import { never } from "../../../testing/render";
import { DeskReportView } from "./DeskReport";

const PATH = { path: "/lapor/meja/LA-241126-01" };

describe("a report on the desk", () => {
  test("its header, every value with where it came from, the reporter, the history and the reporter's answers", async () => {
    await renderDesk(<DeskReportView report={REPORT} summary={SUMMARY} />, PATH);
    const heading = screen.getByRole("heading", { level: 1, name: "LA-241126-01" });
    const header = within(heading.closest("header") as HTMLElement);
    expect(header.getByText("Dilihat")).toBeTruthy();
    expect(header.getByText("Nomor belum diverifikasi")).toBeTruthy();
    expect(screen.getByText("Desa/Kel. Sukamaju, Kec. Contoh, Aceh Utara")).toBeTruthy();
    expect(screen.getAllByText("Meninggal: 2 orang").length).toBeGreaterThan(0);
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
    };
    await renderDesk(
      <DeskReportView
        report={{
          ...REPORT,
          numberUnverified: false,
          reporterWords: [],
          photos: [photo],
          reporter: { ...REPORT.reporter, role: "citizen", officerRegency: null, officerPosition: null },
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
    await renderDesk(<DeskReportView report={REPORT} summary={SUMMARY} refusal={envelope("desk.notAllowed")} />, PATH);
    expect(screen.getByRole("alert").textContent).toContain("belum berhak");
  });

  test("a change kept says so once, with where the ticket is now", async () => {
    const saved = (entry: string) =>
      renderDesk(<DeskReportView report={REPORT} summary={SUMMARY} />, { ...PATH, entry: `${PATH.path}${entry}` });
    const moved = await saved("?saved=status");
    expect(screen.getByRole("status").textContent).toBe("Status tersimpan. Tiket sekarang: Sudah dilihat petugas.");
    moved.unmount();
    const replied = await saved("?saved=reply");
    expect(screen.getByRole("status").textContent).toBe("Balasan tersimpan. Status tiket: Sudah dilihat petugas.");
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
          fields: [{ fieldId: "note", copyKey: "fieldError.staffReason.tooShort", params: { min: 5 } }],
        }}
        typed={{ to: "invalid", note: "dup", reply: "" }}
      />,
      PATH,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    const actions = within(screen.getByRole("region", { name: "Tindak lanjut" }));
    expect(actions.getByText(/Alasan terlalu pendek/)).toBeTruthy();
  });
});
