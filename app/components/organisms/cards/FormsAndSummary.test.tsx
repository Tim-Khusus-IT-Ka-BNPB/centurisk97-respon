import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { Card } from "../../../../src/contract/card";
import type { DraftBody } from "../../../../src/contract/draft";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import { SAMPLE_DRAFTS } from "../../../../src/testing/samples";
import { never, renderDraft } from "../../../testing/render";
import { CardView } from "../CardView";
import { useDraftView } from "./CardShell";
import { dateFocusTarget } from "./TimeCards";

function Lonely() {
  useDraftView();
  return null;
}

const refusal = (fields: ErrorEnvelope["fields"], code = "request.invalidFields"): ErrorEnvelope =>
  ({ error: { code, copyKey: `error.${code}`, params: {} }, fields, retryAt: null, draft: null }) as ErrorEnvelope;
const draw = (draft: DraftBody, options: Parameters<typeof renderDraft>[2] = {}) =>
  renderDraft(<CardView card={draft.card} />, draft, options);

describe("number forms", () => {
  test("each box has its label, unit and definition; the card answers all at once or saves", async () => {
    draw(SAMPLE_DRAFTS.numberForm, { action: never });
    const dead = await screen.findByLabelText(/Meninggal/);
    expect(dead.getAttribute("name")).toBe("dead");
    expect(dead.getAttribute("inputmode")).toBe("numeric");
    expect(dead.getAttribute("placeholder")).toBeNull();
    expect(screen.getAllByText("orang")).toHaveLength(3);
    expect(screen.getByText(/Masih kosong/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tidak ada semua" }));
    await screen.findByRole("button", { name: "Menyimpan jawaban..." });
  });

  test("a refused box keeps every value, shows its error under it and takes focus", async () => {
    draw(SAMPLE_DRAFTS.numberForm, {
      envelope: refusal([
        { fieldId: "injured", copyKey: "fieldError.wholeNumber", params: { label: "field.injured.label" } },
      ]),
      posted: { dead: ["2"], injured: ["1,5"] },
    });
    const injured = (await screen.findByLabelText(/Luka-luka/)) as HTMLInputElement;
    expect((screen.getByLabelText(/Meninggal/) as HTMLInputElement).value).toBe("2");
    expect(injured.value).toBe("1,5");
    expect(injured.getAttribute("aria-invalid")).toBe("true");
    expect(injured.getAttribute("aria-describedby")).toBe("injured-error");
    expect(screen.getByText(/Luka-luka diisi angka bulat/)).toBeTruthy();
    expect(document.activeElement).toBe(injured);
  });

  test("a form with neither form action offers only the save", async () => {
    const card = { ...SAMPLE_DRAFTS.numberForm.card, formActions: [] } as Card;
    draw({ ...SAMPLE_DRAFTS.numberForm, card });
    await screen.findByRole("button", { name: "Simpan jawaban" });
    expect(screen.queryByRole("button", { name: "Tidak ada semua" })).toBeNull();
  });

  test("RT and RW sit side by side with Tidak tahu and the save", async () => {
    const card = SAMPLE_DRAFTS.neighbourhood.card as Extract<Card, { kind: "neighbourhood" }>;
    const fields = card.fields.map((box) => ({ ...box, labelKey: `field.neighbourhood.${box.id}` }));
    draw(
      { ...SAMPLE_DRAFTS.neighbourhood, card: { ...card, fields } },
      {
        envelope: refusal([
          { fieldId: "rw", copyKey: "fieldError.digits", params: { label: "field.neighbourhood.rw" } },
        ]),
        posted: { rt: ["4"], rw: ["abcd"] },
      },
    );
    expect(((await screen.findByLabelText("RT")) as HTMLInputElement).value).toBe("4");
    expect(document.activeElement).toBe(screen.getByLabelText("RW"));
    expect(screen.getByRole("button", { name: "Tidak tahu" }).getAttribute("value")).toBe("unknown");
  });

  test("a text question counts what is typed, live with script", async () => {
    draw(SAMPLE_DRAFTS.textQuestion);
    const box = await screen.findByRole("textbox");
    expect(screen.getByText("0 dari 300 huruf")).toBeTruthy();
    fireEvent.input(box, { target: { value: "balai" } });
    expect(screen.getByText("5 dari 300 huruf")).toBeTruthy();
    expect(screen.getByText(/Jangan tulis nama orang/)).toBeTruthy();
  });

  test("a text question asked again says it is still empty", async () => {
    const card = SAMPLE_DRAFTS.textQuestion.card as Extract<Card, { kind: "textQuestion" }>;
    const again = {
      ...card,
      promptKey: null,
      fields: card.fields.map((box) => ({ ...box, askedBefore: true, maxLength: null })),
    };
    draw({ ...SAMPLE_DRAFTS.textQuestion, card: again });
    expect(await screen.findByText(/Masih kosong/)).toBeTruthy();
    expect(screen.getByText("0 dari 0 huruf")).toBeTruthy();
  });
});

describe("the time card", () => {
  test("four days, a date shown by CSS, the hour with its zone, and no hour", async () => {
    draw(SAMPLE_DRAFTS.timeCard);
    expect(await screen.findByLabelText("Hari ini")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByText("WIT")).toBeTruthy();
    const date = screen.getByLabelText("Tanggal") as HTMLInputElement;
    expect([date.min, date.max]).toEqual(["2026-10-24", "2026-11-23"]);
    expect(screen.getByLabelText("Tidak tahu jamnya").getAttribute("value")).toBe("hourUnknown");
  });

  test("a refused date focuses the picked day, or the date box when Tanggal lain is picked", async () => {
    const tooOld = refusal([
      { fieldId: "date", copyKey: "fieldError.time.tooOld", params: { label: "card.timeCard.date" } },
    ]);
    draw(SAMPLE_DRAFTS.timeCard, { envelope: tooOld, posted: { optionIds: ["otherDate"], date: ["2026-01-01"] } });
    const date = await screen.findByLabelText("Tanggal");
    expect(document.activeElement).toBe(date);
    expect(date.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/lebih dari 30 hari lalu/)).toBeTruthy();
    expect(dateFocusTarget(["yesterday"])).toBe("day-yesterday");
    expect(dateFocusTarget(null)).toBe("day-today");
    expect(dateFocusTarget(["otherDate"])).toBe("date");
  });

  test("a refused hour focuses the hour", async () => {
    const hour = refusal([
      { fieldId: "hour", copyKey: "fieldError.time.hourFormat", params: { label: "card.timeCard.hour" } },
    ]);
    draw(SAMPLE_DRAFTS.timeCard, { envelope: hour, posted: { optionIds: ["today"], hour: ["25"] } });
    const hourBox = await screen.findByLabelText("Jam");
    await waitFor(() => expect(document.activeElement?.id).toBe(hourBox.id));
  });

  test("a time card with fewer choices and no date box still draws", async () => {
    const card = SAMPLE_DRAFTS.timeCard.card as Extract<Card, { kind: "timeCard" }>;
    const short = { ...card, fields: [], options: card.options.filter((option) => option.id === "today") };
    draw({ ...SAMPLE_DRAFTS.timeCard, card: short });
    expect(await screen.findAllByRole("radio")).toHaveLength(1);
    expect(screen.getByLabelText("Tidak tahu jamnya")).toBeTruthy();
  });
});

describe("the chronology review", () => {
  test("the joined story shows, the note opens on a refusal and keeps its text", async () => {
    draw(SAMPLE_DRAFTS.chronologyReview, {
      envelope: refusal([
        {
          fieldId: "note",
          copyKey: "fieldError.text.tooLong",
          params: { label: "card.chronologyReview.add", length: 301, max: 300 },
        },
      ]),
      posted: { note: ["x"] },
    });
    expect(await screen.findByText(/Hujan dengan intensitas tinggi/)).toBeTruthy();
    expect(document.querySelector("details")?.open).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
    expect(screen.getByRole("button", { name: "Tidak ada, lanjut" }).getAttribute("value")).toBe("done");
  });

  test("closed and empty by default, even with a non-chronology value", async () => {
    const card = SAMPLE_DRAFTS.chronologyReview.card as Extract<Card, { kind: "chronologyReview" }>;
    draw({ ...SAMPLE_DRAFTS.chronologyReview, card: { ...card, chronology: { kind: "text", text: "x" }, fields: [] } });
    expect(await screen.findByText("0 dari 0 huruf")).toBeTruthy();
    draw({ ...SAMPLE_DRAFTS.chronologyReview, card: { ...card, promptKey: null } });
    expect(await screen.findByText("0 dari 0 huruf")).toBeTruthy();
    expect(document.querySelector("details")?.open).toBe(false);
  });
});

describe("summary and the end of a draft", () => {
  test("the summary shows percent, kept-until, the 112 line, the reporter, groups with Ubah, and the states", async () => {
    draw(SAMPLE_DRAFTS.summary, { action: never });
    expect(await screen.findByText("Lengkap 62 persen")).toBeTruthy();
    expect(screen.getByText(/disimpan sampai pukul 08\.01 WIB, 24 November 2026/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Telepon 112" })).toBeTruthy();
    expect(screen.getByText("Pelapor: Uji Satu (Petugas BPBD)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ubah Korban" }).textContent).toBe("Ubah");
    expect(screen.getByText("Rusak berat: 3 rumah")).toBeTruthy();
    expect(screen.getByText("Meninggal:").textContent).toBe("Meninggal: tidak ada");
    expect(screen.getByText("Hilang:").textContent).toBe("Hilang: tidak tahu");
    expect(screen.getByText("Luka-luka:").textContent).toBe("Luka-luka: belum didata");
    expect(screen.getByText("2 foto, 1 dengan lokasi terekam")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Kirim" }));
    await screen.findByRole("button", { name: "Mengirim laporan..." });
  });

  test("an emergency's summary says so with what was told of victims, in place of how complete it is", async () => {
    const card = SAMPLE_DRAFTS.summary.card as Extract<Card, { kind: "summary" }>;
    draw({ ...SAMPLE_DRAFTS.summary, card: { ...card, emergency: { victims: "yes" } } });
    expect(await screen.findByText("Laporan darurat, sedang berlangsung")).toBeTruthy();
    expect(screen.getByText("Orang terluka, hilang, atau terjebak: Ya, ada")).toBeTruthy();
    expect(screen.queryByText(/^Lengkap/)).toBeNull();
  });

  test("a summary with no photos says so", async () => {
    const card = SAMPLE_DRAFTS.summary.card as Extract<Card, { kind: "summary" }>;
    draw({ ...SAMPLE_DRAFTS.summary, card: { ...card, photos: { count: 0, withPlace: 0 } } });
    expect(await screen.findByText("Tanpa foto")).toBeTruthy();
  });

  test("a failed send says so above Kirim and keeps focus on it", async () => {
    draw(SAMPLE_DRAFTS.summary, { envelope: refusal([], "send.failed") });
    const send = await screen.findByRole("button", { name: "Kirim" });
    expect(screen.getByRole("alert").textContent).toContain("Laporan belum terkirim");
    expect(send.id).toBe("send");
  });

  test("a confirm says what is lost, the accept and the way back each in a row", async () => {
    draw(SAMPLE_DRAFTS.confirm);
    expect(await screen.findByRole("heading", { name: "Batalkan laporan ini?" })).toBeTruthy();
    const kinds = [...document.querySelectorAll<HTMLInputElement>('input[name="kind"]')].map((input) => input.value);
    expect(kinds).toEqual(["confirm", "dismiss"]);
  });

  test("a confirm with no body still draws", async () => {
    draw({ ...SAMPLE_DRAFTS.confirm, card: { ...SAMPLE_DRAFTS.confirm.card, promptKey: null } as Card });
    expect(await screen.findByRole("button", { name: "Lanjutkan mengisi" })).toBeTruthy();
  });

  test("a cancelled report says so", async () => {
    draw(SAMPLE_DRAFTS.cancelled);
    expect(await screen.findByText("Isi laporan sudah dihapus. Tidak ada yang terkirim.")).toBeTruthy();
    draw({ ...SAMPLE_DRAFTS.cancelled, card: { ...SAMPLE_DRAFTS.cancelled.card, promptKey: null } as Card });
  });

  test("a lost connection says so and keeps the card", async () => {
    draw(SAMPLE_DRAFTS.numberForm, { networkLost: true });
    expect((await screen.findByRole("alert")).textContent).toContain("Sambungan terputus");
  });

  test("a card drawn outside its draft page is a programming mistake", () => {
    expect(() => render(<Lonely />)).toThrow("outside its draft page");
  });
});

describe("cards with the least the contract allows", () => {
  test("no prompt, no definition and no unit still draw a usable card", async () => {
    const form = SAMPLE_DRAFTS.numberForm.card as Extract<Card, { kind: "numberForm" }>;
    const bare = {
      ...form,
      promptKey: null,
      fields: form.fields
        .slice(0, 1)
        .map((box) => ({ ...box, id: "notAField", labelKey: "field.dead.label", definitionKey: null })),
    };
    draw({ ...SAMPLE_DRAFTS.numberForm, card: bare });
    const box = await screen.findByLabelText("Meninggal");
    expect(box.getAttribute("aria-describedby")).toBeNull();
    const rtrw = SAMPLE_DRAFTS.neighbourhood.card as Extract<Card, { kind: "neighbourhood" }>;
    const neighbourhood = {
      ...rtrw,
      fields: rtrw.fields.map((field) => ({ ...field, labelKey: `field.neighbourhood.${field.id}` })),
    };
    for (const sample of [
      { ...SAMPLE_DRAFTS.neighbourhood, card: neighbourhood },
      SAMPLE_DRAFTS.textQuestion,
      SAMPLE_DRAFTS.timeCard,
    ]) {
      draw({ ...sample, card: { ...sample.card, promptKey: null } as Card });
      await screen.findAllByRole("heading");
    }
  });

  test("a citizen reporter is named as such", async () => {
    const card = SAMPLE_DRAFTS.summary.card as Extract<Card, { kind: "summary" }>;
    draw({ ...SAMPLE_DRAFTS.summary, card: { ...card, reporter: { name: "Uji Dua", role: "citizen" } } });
    expect(await screen.findByText("Pelapor: Uji Dua (Warga)")).toBeTruthy();
  });

  test("a cancelled card with no body draws its heading", async () => {
    draw({ ...SAMPLE_DRAFTS.cancelled, card: { ...SAMPLE_DRAFTS.cancelled.card, promptKey: null } as Card });
    expect(await screen.findByRole("heading", { name: "Laporan dibatalkan" })).toBeTruthy();
    expect(screen.queryByText(/Isi laporan sudah dihapus/)).toBeNull();
  });
});
