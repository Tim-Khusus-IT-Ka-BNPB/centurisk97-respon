import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { envelope } from "../../../../src/api/envelope";
import { fieldErrors } from "../../../../src/api/routes/shared";
import { FILTERS, ITEM, list, queue, REPORT, renderDesk, SENT, SUMMARY } from "../../../testing/desk";
import { never } from "../../../testing/render";

vi.mock("../DeskMapCanvas", () => ({ SMALL: {}, DeskMapCanvas: () => null }));

import { DeskQueueView } from "./DeskQueue";
import { DeskReportView } from "./DeskReport";

const PATH = { path: "/desk/LA-241126-01" };
const AREAS = [
  { area: "11", name: "Aceh", level: "province" as const },
  { area: "11.08", name: "Aceh Utara", level: "regency" as const },
  { area: "11.71", name: "Kota Banda Aceh", level: "regency" as const },
  { area: "12", name: "Sumatera Utara", level: "province" as const },
  { area: "12.01", name: "Nias", level: "regency" as const },
];
const panel = () => within(screen.getByRole("region", { name: "BPBD penanggung jawab" }));
// The chips on the reports, not the side menu's queue of the same name.
const heldChips = () => screen.getAllByText("Perlu dicek").filter((one) => one.closest("nav") === null);
const held = { ...REPORT, assignment: { ...REPORT.assignment, held: true } };

describe("which BPBD has a report, and how sure the desk can be of it", () => {
  test("the BPBD, the tier with its score, and each reason in words", async () => {
    const report = {
      ...REPORT,
      triage: {
        tier: "tinggi" as const,
        score: 75,
        reasons: ["gps" as const, "searched" as const, "invalidBefore" as const, "concern.pastEvent" as const],
      },
    };
    await renderDesk(<DeskReportView report={report} summary={SUMMARY} />, PATH);
    expect(panel().getByText("BPBD Aceh Utara")).toBeTruthy();
    expect(panel().getByText("Laporan ini ada di antrean BPBD Aceh Utara.")).toBeTruthy();
    expect(panel().getByText("Keyakinan tinggi")).toBeTruthy();
    expect(panel().getByText("Skor keyakinan 75 dari 100")).toBeTruthy();
    const reasons = panel()
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(reasons).toEqual([
      "Lokasi dari GPS ponsel, di dalam desa yang dilaporkan.",
      "Lokasi dipilih pelapor dari pencarian nama desa.",
      "Nomor ini pernah mengirim laporan yang dinyatakan tidak valid.",
      "AI: kejadiannya sudah lama lewat, tidak sedang terjadi.",
    ]);
    // The header carries the tier too.
    expect(screen.getAllByText("Keyakinan tinggi")).toHaveLength(2);
    // An account that may not give it on sees no form for it.
    expect(panel().queryByText("Serahkan ke BPBD lain")).toBeNull();
  });

  test("a life at risk is named first, and a report sent before triage says why it has no reasons", async () => {
    const life = { ...REPORT, triage: { tier: "darurat" as const, score: 30, reasons: ["lifeAtRisk" as const] } };
    const view = await renderDesk(<DeskReportView report={life} summary={SUMMARY} />, PATH);
    expect(panel().getByText(/nyawa terancam/)).toBeTruthy();
    expect(screen.getAllByText("Darurat").length).toBeGreaterThan(0);
    view.unmount();
    const before = { ...REPORT, triage: { tier: "sedang" as const, score: 40, reasons: [] } };
    await renderDesk(<DeskReportView report={before} summary={SUMMARY} />, PATH);
    expect(panel().getByText(/dikirim sebelum ada penilaian keyakinan/)).toBeTruthy();
    expect(panel().queryAllByRole("listitem")).toHaveLength(0);
  });

  test("held: no BPBD sees it yet, and Pusdalops releases it to the one it has in one press", async () => {
    await renderDesk(<DeskReportView report={held} summary={SUMMARY} areas={AREAS} />, PATH);
    expect(panel().getByText("Ditahan untuk dicek Pusdalops. BPBD Aceh Utara belum melihat laporan ini.")).toBeTruthy();
    expect(heldChips()).toHaveLength(2);
    const release = panel().getByRole("button", { name: "Teruskan ke BPBD Aceh Utara" }) as HTMLButtonElement;
    const sent = new FormData(release.form as HTMLFormElement);
    expect(Object.fromEntries(sent)).toEqual({ action: "assign", area: "11.08", revision: String(REPORT.revision) });
  });

  test("Pusdalops gives it to another BPBD: every province before its regencies, the one it has picked", async () => {
    await renderDesk(<DeskReportView report={REPORT} summary={SUMMARY} areas={AREAS} />, PATH);
    expect(panel().queryByRole("button", { name: /Teruskan/ })).toBeNull();
    fireEvent.click(panel().getByText("Serahkan ke BPBD lain"));
    const select = panel().getByLabelText("BPBD tujuan") as HTMLSelectElement;
    expect(select.value).toBe("11.08");
    const groups = [...select.querySelectorAll("optgroup")].map((group) => [
      group.label,
      [...group.querySelectorAll("option")].map((option) => `${option.value} ${option.textContent}`),
    ]);
    expect(groups).toEqual([
      ["Aceh", ["11 BPBD Provinsi Aceh", "11.08 Aceh Utara", "11.71 Kota Banda Aceh"]],
      ["Sumatera Utara", ["12 BPBD Provinsi Sumatera Utara", "12.01 Nias"]],
    ]);
    const form = select.form as HTMLFormElement;
    expect(Object.fromEntries(new FormData(form))).toEqual({
      action: "assign",
      revision: String(REPORT.revision),
      area: "11.08",
    });
  });

  test("a refused area opens the form with the fix; a closed report is not given on", async () => {
    const refused = envelope("request.invalidFields", {
      fields: fieldErrors([{ fieldId: "area", rule: "area.unknown", params: {} }]),
    });
    const view = await renderDesk(
      <DeskReportView report={REPORT} summary={SUMMARY} areas={AREAS} refusal={refused} />,
      PATH,
    );
    expect(panel().getByText(/Wilayah itu tidak ada dalam daftar/)).toBeTruthy();
    expect((panel().getByLabelText("BPBD tujuan") as HTMLSelectElement).getAttribute("aria-invalid")).toBe("true");
    view.unmount();
    await renderDesk(<DeskReportView report={{ ...held, status: "closed" }} summary={SUMMARY} areas={AREAS} />, PATH);
    expect(panel().queryByText("Serahkan ke BPBD lain")).toBeNull();
    expect(panel().queryByRole("button", { name: /Teruskan/ })).toBeNull();
  });

  test("a give on its way says so, and the history names the BPBD it went to", async () => {
    const given = {
      ...held,
      history: [
        ...REPORT.history,
        {
          status: "new" as const,
          at: SENT,
          actor: "Pusdalops BNPB, Petugas Uji",
          note: null,
          forwardedTo: null,
          event: "assigned" as const,
          detail: { area: "Jawa Barat" },
        },
      ],
    };
    await renderDesk(<DeskReportView report={given} summary={SUMMARY} areas={AREAS} />, { ...PATH, action: never });
    expect(screen.getByText("Diserahkan ke BPBD Jawa Barat")).toBeTruthy();
    fireEvent.click(panel().getByRole("button", { name: "Teruskan ke BPBD Aceh Utara" }));
    expect(await panel().findAllByRole("button", { name: "Menyimpan..." })).toHaveLength(2);
  });

  test("a province's BPBD is named as one, on the page and in what was saved", async () => {
    const province = { ...REPORT, assignment: { area: "12", name: "Sumatera Utara", held: false } };
    await renderDesk(<DeskReportView report={province} summary={SUMMARY} />, {
      ...PATH,
      entry: `${PATH.path}?saved=assignment`,
    });
    expect(panel().getByText("BPBD Provinsi Sumatera Utara")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "Laporan ini sekarang di tangan BPBD Provinsi Sumatera Utara.",
    );
  });
});

describe("the queue shows each report's BPBD and tier", () => {
  test("in the table and the cards, with a held one marked", async () => {
    const items = [ITEM, { ...ITEM, ticketNumber: "LA-241126-02", assignment: { ...ITEM.assignment, held: true } }];
    await renderDesk(
      <DeskQueueView shown={list(queue({ items, total: 2 }))} filters={FILTERS} summary={SUMMARY} envelope={null} />,
      { path: "/desk" },
    );
    expect(screen.getAllByText("BPBD Aceh Utara")).toHaveLength(4);
    expect(screen.getAllByText("Keyakinan sedang")).toHaveLength(4);
    expect(heldChips()).toHaveLength(2);
  });
});

describe("the held queue in the side menu", () => {
  const menu = () => within(screen.getAllByRole("navigation", { name: "Antrean kerja" })[0] as HTMLElement);
  const drawQueue = (summary: typeof SUMMARY, has = "") =>
    renderDesk(
      <DeskQueueView shown={list(queue())} filters={{ ...FILTERS, has }} summary={summary} envelope={null} />,
      { path: "/desk" },
    );

  test("Pusdalops sees how many wait to be checked, and the queue is marked when open", async () => {
    const view = await drawQueue({ ...SUMMARY, byHas: { ...SUMMARY.byHas, held: 2 } });
    const held = menu().getByRole("link", { name: "Perlu dicek, 2 laporan" });
    expect(held.getAttribute("href")).toBe("/desk?view=list&has=held");
    expect(held.getAttribute("aria-current")).toBeNull();
    view.unmount();
    await drawQueue(SUMMARY, "held");
    expect(
      menu()
        .getByRole("link", { name: /^Perlu dicek/ })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      menu()
        .getByRole("link", { name: /^Semua laporan/ })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  test("a BPBD, which never sees a held report, has no such queue", async () => {
    await drawQueue({ ...SUMMARY, mayAssign: false });
    expect(menu().queryByRole("link", { name: /^Perlu dicek/ })).toBeNull();
  });
});
