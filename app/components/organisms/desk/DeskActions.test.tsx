import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { envelope } from "../../../../src/api/envelope";
import { REPORT, renderDesk, SENT } from "../../../testing/desk";
import { never } from "../../../testing/render";
import { DeskActions } from "./DeskActions";

const PATH = { path: "/lapor/meja/LA-241126-01" };
const draw = (props: Partial<Parameters<typeof DeskActions>[0]> = {}, options: object = {}) =>
  renderDesk(<DeskActions report={REPORT} envelope={null} typed={null} {...props} />, { ...PATH, ...options });
const onField = (fieldId: string, copyKey: string, params = {}) => ({
  ...envelope("request.invalidFields"),
  fields: [{ fieldId, copyKey, params }],
});

describe("moving a ticket", () => {
  test("offers only the statuses allowed from here, and the note follows the one picked", async () => {
    await draw();
    expect(screen.getAllByRole("radio").map((radio) => (radio as HTMLInputElement).value)).toEqual([
      "under_review",
      "invalid",
    ]);
    const note = screen.getByLabelText("Catatan");
    expect(screen.getByText(/^Wajib untuk Ditindaklanjuti/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Sedang ditelaah" }));
    expect(screen.getByText(/^Boleh dikosongkan/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Tidak dapat ditindaklanjuti" }));
    expect(screen.getByLabelText("Alasan untuk pelapor")).toBe(note);
    expect(screen.getByText(/Pelapor membaca alasan ini di halaman lacak/)).toBeTruthy();
    expect((document.querySelector('input[name="revision"]') as HTMLInputElement).value).toBe("1");
  });

  test("a closed ticket can only be opened again, already picked", async () => {
    await draw({
      report: { ...REPORT, status: "closed", nextStatuses: [{ status: "under_review", note: "required" }] },
    });
    const reopen = screen.getByRole("radio", { name: "Buka lagi, kembali ke Sedang ditelaah" });
    expect((reopen as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/^Wajib diisi/)).toBeTruthy();
  });

  test("one set aside reads the same way", async () => {
    await draw({
      report: { ...REPORT, status: "invalid", nextStatuses: [{ status: "under_review", note: "required" }] },
    });
    expect(screen.getByRole("radio", { name: "Buka lagi, kembali ke Sedang ditelaah" })).toBeTruthy();
  });

  test("forwarding names the desk of the report's own regency", async () => {
    await draw({
      report: { ...REPORT, status: "under_review", nextStatuses: [{ status: "forwarded", note: "optional" }] },
    });
    expect(screen.getByRole("radio", { name: "Teruskan ke meja BPBD Aceh Utara" })).toBeTruthy();
  });

  test("a new report has nowhere to go until it is seen, but can be answered", async () => {
    await draw({ report: { ...REPORT, status: "new", nextStatuses: [] } });
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("Status bisa diubah setelah laporan ini ditandai dilihat.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Simpan balasan" })).toBeTruthy();
  });

  test("a refused change keeps what was typed, names the fix, and puts focus on the field", async () => {
    await draw({
      envelope: onField("note", "fieldError.staffReason.tooShort", { min: 5 }),
      typed: { to: "invalid", note: "dup", reply: "" },
    });
    expect((screen.getByRole("radio", { name: "Tidak dapat ditindaklanjuti" }) as HTMLInputElement).checked).toBe(true);
    const note = screen.getByLabelText("Alasan untuk pelapor") as HTMLTextAreaElement;
    expect(note.value).toBe("dup");
    expect(screen.getByText(/Alasan terlalu pendek. Tulis paling sedikit 5 huruf/)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(note));
  });

  test("a change on its way says so on its own button only", async () => {
    await draw({}, { action: never });
    fireEvent.click(screen.getByRole("radio", { name: "Sedang ditelaah" }));
    fireEvent.click(screen.getByRole("button", { name: "Simpan status" }));
    expect(await screen.findByRole("button", { name: "Menyimpan..." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Simpan balasan" })).toBeTruthy();
  });
});

describe("writing back", () => {
  test("replies are listed with their officer and time, and the form says they are not delivered yet", async () => {
    await draw({
      report: {
        ...REPORT,
        replies: [
          { text: "Terima kasih", at: SENT, actor: "Petugas Uji" },
          { text: "Kami cek", at: SENT, actor: "Petugas Uji" },
        ],
      },
    });
    expect(screen.getByText(/Pelapor menerimanya mulai fitur kabar/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Balasan tersimpan (2)" })).toBeTruthy();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Terima kasihPetugas Uji, 24 November 2026, pukul 09.30 WIB",
      "Kami cekPetugas Uji, 24 November 2026, pukul 09.30 WIB",
    ]);
  });

  test("a refused reply keeps its text and focus", async () => {
    await draw({
      envelope: onField("reply", "fieldError.required", { label: "desk.reply.label" }),
      typed: { to: "", note: "", reply: "  " },
    });
    const reply = screen.getByLabelText("Balas pelapor") as HTMLTextAreaElement;
    expect(reply.value).toBe("  ");
    expect(screen.getByText("Balasan belum diisi. Isi Balasan untuk melanjutkan.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(reply));
    expect(screen.queryByRole("heading", { name: /Balasan tersimpan/ })).toBeNull();
  });

  test("a reply on its way says so", async () => {
    await draw({}, { action: never });
    fireEvent.change(screen.getByLabelText("Balas pelapor"), { target: { value: "Kami cek" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan balasan" }));
    expect(await screen.findByRole("button", { name: "Menyimpan..." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Simpan status" })).toBeTruthy();
  });
});
