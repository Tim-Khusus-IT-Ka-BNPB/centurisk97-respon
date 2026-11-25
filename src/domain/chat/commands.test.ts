import { describe, expect, test } from "vitest";
import { newsWithTicket, readCommand, tellsOfEvent } from "./commands";

describe("commands", () => {
  test.each([
    ["help", ["bantuan", "Menu", "help", "cara lapor", "?"]],
    ["start", ["lapor", "LAPOR!", "mulai", "lapor bencana", "laporan baru", "buat laporan baru", "buat laporan"]],
    ["emergency", ["darurat", "Lapor darurat."]],
    ["repeat", ["ulang", "ulangi", "ulangi!!", "Ulangi..."]],
    ["newsStop", ["berhenti kabar", "hentikan kabar", "stop kabar", "matikan kabar"]],
    ["newsStart", ["nyalakan kabar", "hidupkan kabar", "mulai kabar"]],
    ["identity", ["ganti nama", "ganti data", "ganti identitas"]],
  ])("%s", (kind, texts) => {
    for (const text of texts) expect(readCommand(text), text).toEqual({ kind });
  });

  test.each([
    ["status", ["status", "cek status", "status laporan", "status laporan saya", "Cek status laporan saya."]],
    ["document", ["dokumen", "pdf", "minta dokumen", "kirim pdf"]],
    ["addNews", ["kabar", "tambah kabar", "kabar untuk"]],
  ])("%s, of no ticket in particular", (kind, texts) => {
    for (const text of texts) expect(readCommand(text), text).toEqual({ kind, ticketNumber: null });
  });

  test("a ticket named with it", () => {
    expect(readCommand("status la-251126-01")).toEqual({ kind: "status", ticketNumber: "LA-251126-01" });
    expect(readCommand("cek status laporan saya LA-251126-100")).toEqual({
      kind: "status",
      ticketNumber: "LA-251126-100",
    });
    expect(readCommand("minta dokumen LA-251126-01.")).toEqual({ kind: "document", ticketNumber: "LA-251126-01" });
    expect(readCommand("pdf LA-251126-01")).toEqual({ kind: "document", ticketNumber: "LA-251126-01" });
    expect(readCommand("kabar untuk LA-251126-01")).toEqual({ kind: "addNews", ticketNumber: "LA-251126-01" });
    expect(readCommand("tambah kabar LA-251126-01")).toEqual({ kind: "addNews", ticketNumber: "LA-251126-01" });
  });

  test("a sentence is no command, nor is a word beside a command that names no ticket", () => {
    for (const text of [
      "",
      "lapor ada banjir",
      "saya mau lapor",
      "bantuan apa",
      "butuh bantuan",
      "ulangi lagi",
      "tolong ulangi",
      "keadaan darurat",
      "darurat sekali",
      "berhenti kabar dong",
      "tolong stop kabar",
      "ganti nama saya",
      "mau ganti nama",
      "nyalakan kabar ya",
      "mau nyalakan kabar",
      "status banjir",
      "kabar baik",
      "dokumen hilang",
      "statusnya apa",
      "apa status",
      "minta kabar",
      "itu pdf",
      "kabar LA-251126-01 air naik",
      "kirim dokumen LA-25-01",
      "ula.ngi",
    ])
      expect(readCommand(text), text).toBeNull();
  });
});

describe("news told with its ticket", () => {
  test("the ticket, and what is left to say", () => {
    expect(newsWithTicket("kabar la-251126-01 air naik sepinggang")).toEqual({
      ticketNumber: "LA-251126-01",
      rest: "air naik sepinggang",
    });
    expect(newsWithTicket("Tambah kabar untuk LA-251126-01: mengungsi 30 orang")).toEqual({
      ticketNumber: "LA-251126-01",
      rest: "mengungsi 30 orang",
    });
    expect(newsWithTicket("kabar LA-251126-01")?.rest).toBe("");
    expect(newsWithTicket("kabarnya LA-251126-01 naik")?.rest).toBe("kabarnya naik");
    expect(newsWithTicket("LA-251126-01:air naik")?.rest).toBe("air naik");
    expect(newsWithTicket("LA-251126-100")).toEqual({ ticketNumber: "LA-251126-100", rest: "" });
    expect(newsWithTicket("untuk LA-251126-01, air naik")).toEqual({
      ticketNumber: "LA-251126-01",
      rest: "untuk , air naik",
    });
    expect(newsWithTicket("ada kabar LA-251126-01")?.rest).toBe("ada kabar");
    expect(newsWithTicket("LA-251126-01 - - air")?.rest).toBe("- air");
  });

  test("no ticket, or a number that is not one", () => {
    for (const text of ["kabar", "LA-2511-01", "LA-251126-1", "xLA-251126-01", "LA-251126-01x"])
      expect(newsWithTicket(text), text).toBeNull();
  });
});

describe("an event told with no report open", () => {
  test("its words are known, whole", () => {
    for (const text of [
      "banjir di kampung kami",
      "Ada LONGSOR",
      "rumah roboh",
      "dua orang meninggal",
      "angin kencang tadi",
      "puting beliung",
      "air naik terus",
      "ada korban",
    ])
      expect(tellsOfEvent(text), text).toBe(true);
    for (const text of ["", "halo", "terima kasih", "1", "robek", "pengungsian bagus", "airnya"])
      expect(tellsOfEvent(text), text).toBe(false);
  });

  test("a request the gate refuses is no event, whatever it names", () => {
    expect(tellsOfEvent("minta data korban banjir seluruh indonesia")).toBe(false);
    expect(tellsOfEvent("tolong buatkan puisi banjir")).toBe(false);
  });
});
