import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { envelope } from "../../../src/api/envelope";
import type { DeskQueue, DeskReport } from "../../../src/contract/desk";
import { never, renderPage as stub } from "../../testing/render";
import { DeskQueueView, DeskRefused, DeskReportView, DeskSignIn, spacedNumber } from "./DeskScreens";

// The router stub draws once its loader settles.
async function renderPage(...args: Parameters<typeof stub>) {
  const result = stub(...args);
  await waitFor(() => expect(document.body.textContent).not.toBe(""));
  return result;
}

const SENT = { utc: "2026-11-24T02:30:00.000Z", zone: "WIB" } as const;
const FILTERS = { status: "", hazardType: "", period: "all", ticket: "", page: 1 };

const ITEM: DeskQueue["items"][number] = {
  ticketNumber: "LA-241126-01",
  status: "new",
  hazardType: "flood",
  hazardSubtype: "unknown",
  place: { villageName: "Sukamaju", districtName: "Contoh", regencyName: "Aceh Utara" },
  eventTime: { kind: "dateOnly", localDate: "2026-11-24", zone: "WIB" },
  sentAt: SENT,
  completePercent: 62,
  photoCount: 2,
  reporter: { name: "Uji Satu", role: "citizen" },
  numberUnverified: true,
};

const queue = (overrides: Partial<DeskQueue> = {}): DeskQueue => ({
  account: { label: "Pusdalops BNPB, Petugas Uji" },
  items: [
    ITEM,
    {
      ...ITEM,
      ticketNumber: "LA-241126-02",
      status: "closed",
      hazardSubtype: "unknown",
      eventTime: { kind: "olderThan30Days" },
      numberUnverified: false,
      reporter: { name: "Uji Dua", role: "claimedOfficer" },
    },
  ],
  total: 2,
  page: 1,
  pageCount: 1,
  ...overrides,
});

const REPORT: DeskReport = {
  ...ITEM,
  status: "seen",
  account: { label: "Pusdalops BNPB, Petugas Uji" },
  reporter: {
    name: "Uji Satu",
    role: "claimedOfficer",
    number: "+6280000000001",
    officerRegency: "Kabupaten Uji",
    officerPosition: "Staf",
  },
  groups: [
    {
      groupId: "event",
      rows: [
        {
          fieldId: "hazardType",
          state: "value",
          value: { kind: "hazardType", hazardType: "flood" },
          origin: "tappedOption",
          quote: null,
        },
      ],
    },
    {
      groupId: "victims",
      rows: [
        {
          fieldId: "dead",
          state: "value",
          value: { kind: "count", count: 2 },
          origin: "quote",
          quote: "dua orang meninggal",
        },
        { fieldId: "missing", state: "confirmedUnknown", value: null, origin: "boxEntry", quote: null },
        { fieldId: "injured", state: "notYetKnown", value: null, origin: null, quote: null },
      ],
    },
  ],
  history: [
    { status: "new", at: SENT, actor: null, note: null },
    {
      status: "seen",
      at: { ...SENT, utc: "2026-11-24T02:40:00.000Z" },
      actor: "Pusdalops BNPB, Petugas Uji",
      note: "Dicek",
    },
  ],
  reporterWords: [{ text: "banjir, dua orang meninggal", at: SENT }],
};

describe("the queue", () => {
  test("each report with its status, place, times, reporter and the unverified mark", async () => {
    await renderPage(<DeskQueueView queue={queue()} filters={FILTERS} envelope={null} />, { path: "/lapor/meja" });
    expect(screen.getByRole("heading", { level: 1, name: "Meja laporan" })).toBeTruthy();
    expect(screen.getByText("Masuk sebagai Pusdalops BNPB, Petugas Uji")).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const first = within(rows[0] as HTMLElement);
    expect(first.getByRole("link").getAttribute("href")).toBe("/lapor/meja/LA-241126-01");
    expect(first.getByText("Diterima")).toBeTruthy();
    expect(first.getByText("Banjir, Tidak tahu")).toBeTruthy();
    expect(first.getByText("Desa/Kel. Sukamaju, Kec. Contoh, Aceh Utara")).toBeTruthy();
    expect(first.getByText("Kejadian: 24 November 2026, jam tidak diketahui")).toBeTruthy();
    expect(first.getByText("Dilaporkan 24 November 2026, pukul 09.30 WIB")).toBeTruthy();
    expect(first.getByText("Nomor belum diverifikasi")).toBeTruthy();
    expect(first.getByText("Lengkap 62 persen, 2 foto")).toBeTruthy();
    const second = within(rows[1] as HTMLElement);
    expect(second.getByText("Kejadian: Sudah lebih dari 30 hari")).toBeTruthy();
    expect(second.getByText("Uji Dua, Petugas BPBD (belum dikonfirmasi)")).toBeTruthy();
    expect(second.queryByText("Nomor belum diverifikasi")).toBeNull();
    expect(screen.getByText("2 laporan")).toBeTruthy();
  });

  test("an empty queue says so; several pages link to their neighbours with the filters kept", async () => {
    await renderPage(<DeskQueueView queue={queue({ items: [], total: 0 })} filters={FILTERS} envelope={null} />, {
      path: "/lapor/meja",
    });
    expect(screen.getByText("Belum ada laporan yang cocok dengan saringan ini.")).toBeTruthy();
  });

  test("the middle page of three links both ways", async () => {
    await renderPage(
      <DeskQueueView
        queue={queue({ page: 2, pageCount: 3, total: 120 })}
        filters={{ ...FILTERS, status: "seen", page: 2 }}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    expect(screen.getByRole("link", { name: "Halaman sebelumnya" }).getAttribute("href")).toBe(
      "/lapor/meja?status=seen&period=all",
    );
    expect(screen.getByRole("link", { name: "Halaman berikutnya" }).getAttribute("href")).toBe(
      "/lapor/meja?status=seen&period=all&page=3",
    );
    expect(screen.getAllByText("Halaman 2 dari 3").length).toBeGreaterThan(0);
  });

  test("the first and last pages link one way; a page with no filters links home", async () => {
    await renderPage(
      <DeskQueueView queue={queue({ page: 1, pageCount: 2 })} filters={{ ...FILTERS, period: "" }} envelope={null} />,
      {
        path: "/lapor/meja",
      },
    );
    expect(screen.queryByRole("link", { name: "Halaman sebelumnya" })).toBeNull();
    expect(screen.getByRole("link", { name: "Halaman berikutnya" }).getAttribute("href")).toBe("/lapor/meja?page=2");
  });

  test("a refused search shows the queue's filters with the field's fix and no list", async () => {
    const refused = {
      ...envelope("request.invalidFields"),
      fields: [{ fieldId: "ticket", copyKey: "fieldError.ticketNumber.format", params: {} }],
    };
    await renderPage(<DeskQueueView queue={null} filters={{ ...FILTERS, ticket: "0800" }} envelope={refused} />, {
      path: "/lapor/meja",
    });
    expect(
      screen.getByText("Nomor tiket ditulis seperti LA-241126-01. Periksa lagi nomornya, lalu cari."),
    ).toBeTruthy();
    expect((screen.getByLabelText("Nomor tiket") as HTMLInputElement).value).toBe("0800");
    expect(screen.queryByRole("heading", { name: /Daftar laporan/ })).toBeNull();
  });
});

describe("a report", () => {
  test("every value with where it came from, the reporter, the history and the reporter's words", async () => {
    await renderPage(<DeskReportView report={REPORT} />, { path: "/lapor/meja/LA-241126-01" });
    expect(screen.getByRole("heading", { level: 2, name: "LA-241126-01" })).toBeTruthy();
    const values = within(screen.getByRole("region", { name: /Isian laporan/ }));
    expect(values.getByText("Lengkap 62 persen")).toBeTruthy();
    expect(values.getByText("Jenis bencana: Banjir")).toBeTruthy();
    expect(values.getByText("Dipilih pelapor")).toBeTruthy();
    expect(values.getByText("Meninggal: 2 orang")).toBeTruthy();
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
    expect(reporter.getByText("Nomor belum diverifikasi")).toBeTruthy();
    const history = within(screen.getByRole("region", { name: "Riwayat tiket" }));
    expect(history.getByText("Sistem")).toBeTruthy();
    expect(history.getByText("Pusdalops BNPB, Petugas Uji")).toBeTruthy();
    expect(history.getByText("Dicek")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Jawaban pelapor" })).getByText("banjir, dua orang meninggal"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tandai sudah dilihat" })).toBeNull();
  });

  test("a verified number and a citizen with no words of their own", async () => {
    await renderPage(
      <DeskReportView
        report={{
          ...REPORT,
          numberUnverified: false,
          reporterWords: [],
          reporter: { ...REPORT.reporter, role: "citizen", officerRegency: null, officerPosition: null },
        }}
      />,
    );
    expect(screen.queryByText("Nomor belum diverifikasi")).toBeNull();
    expect(screen.getByText("Belum ada jawaban pelapor yang tercatat.")).toBeTruthy();
  });

  test("opening it posts the open once; a new report also offers the button for a page with no script", async () => {
    const posted = vi.fn(() => null);
    await renderPage(<DeskReportView report={{ ...REPORT, status: "new" }} />, {
      path: "/lapor/meja/LA-241126-01",
      action: posted,
    });
    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Tandai sudah dilihat" })).toBeTruthy();
  });
});

describe("busy and repeated posts", () => {
  test("an open still on its way shows the button busy", async () => {
    await renderPage(<DeskReportView report={{ ...REPORT, status: "new" }} />, {
      path: "/lapor/meja/LA-241126-01",
      action: never,
    });
    expect(await screen.findByRole("button", { name: "Menyimpan..." })).toBeTruthy();
  });

  test("a code on its way shows the sign-in busy", async () => {
    await renderPage(<DeskSignIn envelope={null} />, { path: "/lapor/meja", action: never });
    fireEvent.change(screen.getByLabelText("Kode masuk"), { target: { value: "kode" } });
    screen.getByRole("button", { name: "Masuk" }).click();
    expect(await screen.findByRole("button", { name: "Memeriksa kode..." })).toBeTruthy();
  });

  test("the last page has no next link, and its previous link with no filters is the plain desk", async () => {
    await renderPage(
      <DeskQueueView
        queue={queue({ page: 2, pageCount: 2 })}
        filters={{ ...FILTERS, period: "", page: 2 }}
        envelope={null}
      />,
      { path: "/lapor/meja" },
    );
    expect(screen.queryByRole("link", { name: "Halaman berikutnya" })).toBeNull();
    expect(screen.getByRole("link", { name: "Halaman sebelumnya" }).getAttribute("href")).toBe("/lapor/meja");
  });
});

describe("signing in and refusals", () => {
  test("a refusal that is not a field's is shown above the form", async () => {
    await renderPage(<DeskSignIn envelope={envelope("request.refused")} />, { path: "/lapor/meja" });
    expect(screen.getByRole("alert").textContent).toContain("Muat ulang halaman");
  });

  test("a refused read over the limit names the time", async () => {
    const limited = {
      ...envelope("limit.desk.read", { params: { limit: 600 } }),
      retryAt: { utc: "2099-01-01T00:00:00.000Z", zone: "WIB" as const },
    };
    await renderPage(<DeskRefused envelope={limited} />, { path: "/lapor/meja" });
    expect(screen.getByText(/paling banyak 600 pembukaan per jam/)).toBeTruthy();
  });

  test("the code field with its fix, focused", async () => {
    const refused = {
      ...envelope("request.invalidFields"),
      fields: [{ fieldId: "code", copyKey: "fieldError.staffCode.unknown", params: {} }],
    };
    await renderPage(<DeskSignIn envelope={refused} />, { path: "/lapor/meja" });
    expect(screen.getByText("Kode masuk tidak dikenal. Periksa kode dari admin, lalu masuk lagi.")).toBeTruthy();
    expect(document.activeElement?.id).toBe("code");
  });

  test("a limit on signing in names the time; a plain refusal names its fix", async () => {
    const limited = {
      ...envelope("limit.address.staffSignIn", { params: { limit: 30 } }),
      retryAt: { utc: "2099-01-01T00:00:00.000Z", zone: "WIB" as const },
    };
    await renderPage(<DeskSignIn envelope={limited} />, { path: "/lapor/meja" });
    expect(screen.getByText(/paling banyak 30 per jam/)).toBeTruthy();
  });

  test("a refused read says why and leads back to the list", async () => {
    await renderPage(<DeskRefused envelope={envelope("desk.notAllowed")} />, { path: "/lapor/meja/x" });
    expect(screen.getByText(/belum berhak memakai meja laporan/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kembali ke daftar laporan" }).getAttribute("href")).toBe("/lapor/meja");
  });

  test("a stored number reads in groups", async () => {
    expect(spacedNumber("+6281234567890")).toBe("+62 812-3456-7890");
  });
});
