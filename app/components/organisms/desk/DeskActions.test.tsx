import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { envelope } from "../../../../src/api/envelope";
import { TextContext } from "../../../lib/text";
import { REPORT, renderDesk, SENT } from "../../../testing/desk";
import { never, text } from "../../../testing/render";

const device = vi.hoisted(() => ({
  bytes: new Uint8Array([1, 2, 3]) as Uint8Array | null,
  fix: null as { lat: number; lon: number; accuracy: number; readAt: number } | null,
}));
vi.mock("../../../lib/device", () => ({
  preparePhoto: async () => device.bytes,
  photoFix: async () => device.fix,
}));

// The test browser cannot post a real file through the router, so a photo's submit is caught here.
const router = vi.hoisted(() => ({ sent: [] as FormData[], options: [] as unknown[] }));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useSubmit: () => (form: FormData, options: unknown) => {
    router.sent.push(form);
    router.options.push(options);
  },
}));

import { DeskActions } from "./DeskActions";

const PATH = { path: "/desk/LA-241126-01" };
const draw = (props: Partial<Parameters<typeof DeskActions>[0]> = {}, options: object = {}) =>
  renderDesk(<DeskActions report={REPORT} envelope={null} typed={null} {...props} />, { ...PATH, ...options });
const onField = (fieldId: string, copyKey: string, params = {}) => ({
  ...envelope("request.invalidFields"),
  fields: [{ fieldId, copyKey, params }],
});
const typed = (values: Record<string, string>, actions: string[] = []) => ({ values, actions });
const WORKING = {
  ...REPORT,
  status: "in_handling" as const,
  nextStatuses: [
    { status: "closed" as const, note: "closing" as const },
    { status: "invalid" as const, note: "reason" as const },
  ],
};
const STARTS = {
  ...REPORT,
  status: "under_review" as const,
  nextStatuses: [
    { status: "in_handling" as const, note: "optional" as const },
    { status: "invalid" as const, note: "reason" as const },
  ],
};
const fold = (title: string) =>
  screen
    .getAllByText(title)
    .find((element) => element.closest("summary") !== null)
    ?.closest("details") as HTMLDetailsElement;

describe("moving a ticket", () => {
  test("offers only the statuses allowed from here, and the note follows the one picked", async () => {
    await draw();
    const move = within(fold("Ubah status"));
    expect(move.getAllByRole("radio").map((radio) => (radio as HTMLInputElement).value)).toEqual([
      "under_review",
      "invalid",
    ]);
    const note = move.getByLabelText("Catatan");
    expect(move.getByText(/^Wajib untuk Tidak dapat ditindaklanjuti/)).toBeTruthy();
    fireEvent.click(move.getByRole("radio", { name: "Sedang ditelaah" }));
    expect(move.getByText(/^Boleh dikosongkan. Hanya petugas/)).toBeTruthy();
    fireEvent.click(move.getByRole("radio", { name: "Tidak dapat ditindaklanjuti" }));
    expect(move.getByLabelText("Alasan untuk pelapor")).toBe(note);
    expect(move.getByText(/Pelapor membaca alasan ini di halaman lacak/)).toBeTruthy();
    expect((document.querySelector('input[name="revision"]') as HTMLInputElement).value).toBe("1");
  });

  test.each(["closed", "invalid"] as const)(
    "a ticket at %s can only be opened again, already picked",
    async (status) => {
      await draw({ report: { ...REPORT, status, nextStatuses: [{ status: "under_review", note: "required" }] } });
      const reopen = screen.getByRole("radio", { name: "Buka lagi, kembali ke Sedang ditelaah" });
      expect((reopen as HTMLInputElement).checked).toBe(true);
      expect(screen.getByText(/^Wajib diisi/)).toBeTruthy();
      expect(screen.queryByText("Pengecekan lapangan")).toBeNull();
    },
  );

  test("forwarding names the desk of the report's own regency", async () => {
    await draw({
      report: { ...REPORT, status: "under_review", nextStatuses: [{ status: "forwarded", note: "optional" }] },
    });
    expect(screen.getByRole("radio", { name: "Teruskan ke meja BPBD Aceh Utara" })).toBeTruthy();
  });

  test("a report closes with a reason until it has a photo of the work", async () => {
    const view = await draw({ report: WORKING });
    fireEvent.click(screen.getByRole("radio", { name: "Selesai ditangani" }));
    expect(screen.getByLabelText("Alasan bila tanpa foto penanganan")).toBeTruthy();
    expect(screen.getByText(/karena belum ada foto penanganan/)).toBeTruthy();
    view.unmount();
    await draw({
      report: {
        ...WORKING,
        proofs: [{ proofId: "1", hasPoint: true, at: SENT, actor: "Petugas", public: false, forwarded: false }],
      },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Selesai ditangani" }));
    expect(screen.getByText(/^Boleh dikosongkan. Hanya petugas/)).toBeTruthy();
  });

  test("a new report has nowhere to go until it is seen; an account with no move from here is told so", async () => {
    const view = await draw({ report: { ...REPORT, status: "new", nextStatuses: [] } });
    expect(within(fold("Ubah status")).queryByRole("radio")).toBeNull();
    expect(screen.getByText("Status bisa diubah setelah laporan ini ditandai dilihat.")).toBeTruthy();
    view.unmount();
    await draw({ report: { ...REPORT, status: "closed", nextStatuses: [] } });
    expect(screen.getByText("Akun ini tidak bisa mengubah status tiket dari sini.")).toBeTruthy();
  });

  test("a refused change keeps what was typed, names the fix, and puts focus on the field", async () => {
    await draw({
      envelope: onField("note", "fieldError.staffText.tooShort", { label: "desk.move.note.reason", min: 5 }),
      typed: typed({ to: "invalid", note: "dup" }),
    });
    const move = within(fold("Ubah status"));
    expect((move.getByRole("radio", { name: "Tidak dapat ditindaklanjuti" }) as HTMLInputElement).checked).toBe(true);
    const note = screen.getByLabelText("Alasan untuk pelapor") as HTMLTextAreaElement;
    expect(note.value).toBe("dup");
    expect(screen.getByText(/Alasan untuk pelapor terlalu pendek. Tulis paling sedikit 5 huruf/)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(note));
  });

  test("a change on its way says so on its own button only", async () => {
    await draw({}, { action: never });
    fireEvent.click(screen.getByRole("radio", { name: "Sedang ditelaah" }));
    fireEvent.click(screen.getByRole("button", { name: "Simpan status" }));
    expect(await screen.findByRole("button", { name: "Menyimpan..." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kirim balasan" })).toBeTruthy();
  });
});

describe("what is being done", () => {
  test("is asked for once the work is picked to start, and only then", async () => {
    await draw({ report: STARTS });
    const evacuation = screen.getByLabelText("Evakuasi warga");
    expect((evacuation.closest("div[hidden]") as HTMLElement | null) === null).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "Ditindaklanjuti" }));
    expect(evacuation.closest("div[hidden]")).toBeNull();
    expect(screen.getByLabelText("Tindakan lain")).toBeTruthy();
  });

  test("a refusal names the fix on the actions, keeps the boxes ticked and takes focus there", async () => {
    await draw({
      report: STARTS,
      envelope: onField("actions", "fieldError.actions.none"),
      typed: typed({ to: "in_handling", otherAction: "" }, ["logistik"]),
    });
    expect(screen.getByText("Pilih paling sedikit satu tindakan, atau tulis tindakan lain.")).toBeTruthy();
    expect((screen.getByLabelText("Distribusi logistik") as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Evakuasi warga")));
  });

  test("with no catalogue only the officer's own words are asked, and the refusal is told there", async () => {
    await draw({
      report: { ...STARTS, offeredActions: [] },
      envelope: onField("actions", "fieldError.actions.none"),
      typed: typed({ to: "in_handling" }),
    });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByLabelText("Tindakan lain").getAttribute("aria-invalid")).toBe("true");
  });

  test("more is added while the work goes on, what was told left out; a refusal opens its fold", async () => {
    const told = [{ label: "Evakuasi warga", at: SENT, actor: "Petugas", public: false }];
    const view = await draw({ report: { ...WORKING, actions: told } });
    expect(fold("Tambah tindakan").open).toBe(false);
    expect(screen.queryByLabelText("Evakuasi warga")).toBeNull();
    view.unmount();
    await draw({
      report: { ...WORKING, actions: told },
      envelope: onField("otherAction", "fieldError.staffText.tooShort", { label: "desk.actions.other", min: 3 }),
      typed: typed({ otherAction: "ok" }),
    });
    const other = screen.getByLabelText("Tindakan lain") as HTMLInputElement;
    expect(other.value).toBe("ok");
    expect((other.closest("details") as HTMLDetailsElement).open).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(other));
  });

  test("an addition on its way says so", async () => {
    await draw({ report: WORKING }, { action: never });
    fireEvent.click(screen.getByLabelText("Evakuasi warga"));
    fireEvent.click(screen.getByRole("button", { name: "Tambah tindakan" }));
    expect(await screen.findByRole("button", { name: "Menyimpan..." })).toBeTruthy();
  });
});

function Served() {
  return (
    <TextContext.Provider value={text}>
      <DeskActions report={WORKING} envelope={null} typed={null} />
    </TextContext.Provider>
  );
}

describe("photos of the work", () => {
  const take = () =>
    fireEvent.change(screen.getByLabelText("Tambah foto penanganan"), {
      target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] },
    });
  beforeEach(() => {
    router.sent.length = 0;
    device.bytes = new Uint8Array([1, 2, 3]);
    device.fix = { lat: 5.1, lon: 97, accuracy: 12, readAt: 1 };
  });

  test("go as soon as one is picked, with the officer's reading", async () => {
    await draw({ report: WORKING });
    expect(screen.getByText(/^0 dari 10 foto/)).toBeTruthy();
    take();
    expect(await screen.findByText("Mengirim foto...")).toBeTruthy();
    await waitFor(() => expect(router.sent).toHaveLength(1));
    expect(router.options[0]).toMatchObject({ method: "post", encType: "multipart/form-data" });
    const form = router.sent[0] as FormData;
    expect([form.get("action"), form.get("lat"), form.get("accuracy")]).toEqual(["proof", "5.1", "12"]);
    expect(form.get("photo")).toBeInstanceOf(File);
    expect(form.get("forwarded")).toBeNull();
    expect(screen.getByLabelText("Tambah foto penanganan").getAttribute("accept")).toBe("image/jpeg");
  });

  test("one ticked forwarded takes any picture and goes marked so, with no reading", async () => {
    await draw({ report: WORKING });
    const box = screen.getByRole("checkbox", { name: /^Foto diteruskan, bukan foto langsung/ }) as HTMLInputElement;
    expect([box.name, box.value, box.checked]).toEqual(["forwarded", "1", false]);
    fireEvent.click(box);
    expect(screen.getByLabelText("Tambah foto penanganan").getAttribute("accept")).toBe("image/*");
    take();
    await waitFor(() => expect(router.sent).toHaveLength(1));
    const form = router.sent[0] as FormData;
    expect([form.get("forwarded"), form.get("lat")]).toEqual(["1", null]);
  });

  test("with no script a file box and its button post the form, and every choice shows", () => {
    const Stub = createRoutesStub([{ path: "/", Component: Served }]);
    const page = document.createElement("div");
    page.innerHTML = renderToString(<Stub />);
    expect(page.querySelector('form[enctype="multipart/form-data"] button')?.textContent).toBe("Kirim foto");
    expect(page.querySelector("#proof")?.className).not.toContain("sr-only");
    expect(page.querySelector("fieldset[hidden]")).toBeNull();
  });

  test("go without a reading when there is none", async () => {
    device.fix = null;
    await draw({ report: WORKING });
    take();
    await waitFor(() => expect(router.sent).toHaveLength(1));
    expect(router.sent[0]?.get("lat")).toBeNull();
  });

  test("one that cannot be read says so and is not sent; picking none does nothing", async () => {
    device.bytes = null;
    await draw({ report: WORKING });
    fireEvent.change(screen.getByLabelText("Tambah foto penanganan"), { target: { files: [] } });
    take();
    expect(await screen.findByText(/Foto tidak terbaca atau terlalu besar/)).toBeTruthy();
    expect(router.sent).toEqual([]);
  });

  test("a refused one names the fix; with all 10 there is no more to add", async () => {
    const view = await draw({ report: WORKING, envelope: onField("proof", "fieldError.photo.proofFormat") });
    expect(screen.getByText(/Foto harus JPEG dan paling besar 3 MB/)).toBeTruthy();
    view.unmount();
    const proofs = Array.from({ length: 10 }, (_, n) => ({
      proofId: String(n),
      hasPoint: false,
      at: SENT,
      actor: "Petugas",
      public: false,
      forwarded: false,
    }));
    await draw({ report: { ...WORKING, proofs } });
    expect(screen.getByText(/^Sudah 10 foto penanganan/)).toBeTruthy();
    expect(screen.queryByLabelText("Tambah foto penanganan")).toBeNull();
  });
});

describe("a check on site", () => {
  test("shows its figures, as they are now, once the report is found partly right", async () => {
    await draw();
    expect(fold("Pengecekan lapangan").open).toBe(false);
    const dead = screen.getByLabelText(/^Meninggal/) as HTMLInputElement;
    expect(dead.closest("fieldset[hidden]")).not.toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /^Sebagian benar/ }));
    expect(dead.closest("fieldset[hidden]")).toBeNull();
    expect(dead.value).toBe("2");
    expect(dead.name).toBe("box.dead");
    const injured = screen.getByLabelText(/^Luka/) as HTMLInputElement;
    expect([injured.value, injured.placeholder]).toEqual(["", "belum didata"]);
  });

  test("a refused figure keeps what was typed and takes focus, its fold open", async () => {
    await draw({
      envelope: onField("dead", "fieldError.wholeNumber", { label: "field.dead.label" }),
      typed: typed({ result: "partly", "box.dead": "dua", checkNote: "Dicek" }),
    });
    const dead = screen.getByLabelText(/^Meninggal/) as HTMLInputElement;
    expect(dead.value).toBe("dua");
    expect(fold("Pengecekan lapangan").open).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(dead));
    expect((screen.getByLabelText("Catatan pengecekan") as HTMLTextAreaElement).value).toBe("Dicek");
  });

  test("a refused result and a refused note each take focus", async () => {
    const view = await draw({
      envelope: onField("result", "fieldError.check.validWithChanges"),
      typed: typed({ result: "valid" }),
    });
    expect(screen.getByText(/Pilih Sebagian benar, atau kembalikan angkanya/)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("radio", { name: /^Valid/ })));
    view.unmount();
    await draw({
      envelope: onField("checkNote", "fieldError.staffText.tooShort", { label: "desk.check.note", min: 5 }),
      typed: typed({ result: "valid", checkNote: "Ok" }),
    });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Catatan pengecekan")));
  });

  test("one on its way says so", async () => {
    await draw({}, { action: never });
    fireEvent.click(screen.getByRole("radio", { name: /^Valid/ }));
    fireEvent.click(screen.getByRole("button", { name: "Simpan pengecekan" }));
    expect(await screen.findByRole("button", { name: "Menyimpan..." })).toBeTruthy();
  });
});

describe("writing back", () => {
  test("a reporter who stopped the news is named as such before a reply is written", async () => {
    const view = await draw({ report: REPORT });
    expect(screen.queryByText(/Pelapor menghentikan kabar/)).toBeNull();
    view?.unmount?.();
    await draw({ report: { ...REPORT, newsStopped: true } });
    expect(screen.getByText(/Pelapor menghentikan kabar/)).toBeTruthy();
  });

  test("replies are listed with their officer and time, and the form says where the reporter reads them", async () => {
    await draw({
      report: {
        ...REPORT,
        replies: [
          { text: "Terima kasih", at: SENT, actor: "Petugas Uji" },
          { text: "Kami cek", at: SENT, actor: "Petugas Uji" },
        ],
      },
    });
    expect(fold("Balas pelapor (2)").open).toBe(false);
    expect(screen.getByText(/Pelapor membacanya di halaman laporannya/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Balasan untuk pelapor" })).toBeTruthy();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Terima kasihPetugas Uji, 24 November 2026, pukul 09.30 WIB",
      "Kami cekPetugas Uji, 24 November 2026, pukul 09.30 WIB",
    ]);
  });

  test("a refused reply keeps its text and focus, its fold open", async () => {
    await draw({
      envelope: onField("reply", "fieldError.required", { label: "desk.reply.label" }),
      typed: typed({ reply: "  " }),
    });
    const reply = screen.getByLabelText("Balasan") as HTMLTextAreaElement;
    expect(reply.value).toBe("  ");
    expect(screen.getByText("Balasan belum diisi. Isi Balasan untuk melanjutkan.")).toBeTruthy();
    expect(fold("Balas pelapor").open).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(reply));
  });

  test("a reply on its way says so", async () => {
    await draw({}, { action: never });
    fireEvent.change(screen.getByLabelText("Balasan"), { target: { value: "Kami cek" } });
    fireEvent.click(screen.getByRole("button", { name: "Kirim balasan" }));
    expect(await screen.findByRole("button", { name: "Menyimpan..." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Simpan status" })).toBeTruthy();
  });
});
