import { describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { deskReportSchema } from "../../contract/desk";
import { browser, manualClock, query, testBindings } from "../../testing/api";
import { pdfText } from "../../testing/documents";
import { chat, type chat as chatOf, GATEWAY_SECRETS, gateway, known, reach, sent } from "../../testing/gateway";
import { api } from "../app";

vi.setConfig({ testTimeout: 60_000 });

const clock = manualClock("2026-11-25T03:00:00.000Z");
const other = `uji-2=${"x".repeat(32)}`;
const { bindings } = testBindings({ GATEWAY_SECRETS: `${GATEWAY_SECRETS} ${other}` }, { clock });
const fetchApi = (request: Request) => {
  clock.advance(20_000);
  return api.app.fetch(request, bindings);
};
const open = (number?: string) => chat(fetchApi, { now: clock.now }, number);
const machine = gateway(fetchApi, { now: clock.now });

type One = ReturnType<typeof chatOf>;
type Kabar = { id: string; number: string; kind: string; text: string; url: string | null; ticketNumber: string };
const waiting = async (one: One): Promise<Kabar[]> => {
  const { json } = await machine.call("GET", "/gateway/news");
  return (json.news as Kabar[]).filter((item) => `+${item.number}` === one.number);
};
const mark = async (id: string) => (await machine.call("POST", `/gateway/news/${id}/delivered`, {})).status;
const path = (item: Kabar | undefined) => new URL(item?.url as string).pathname.replace("/api", "");
const file = async (item: Kabar | undefined, options = {}) => machine.request("GET", path(item), undefined, options);
const drain = async (one: One) => {
  for (const item of await waiting(one)) expect(await mark(item.id)).toBe(200);
};

const desk = () => {
  const phone = browser(fetchApi);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[2] as { token: string }).token);
  return phone;
};
const read = async (ticket: string) =>
  deskReportSchema.parse((await desk().call("GET", `/desk/reports/${ticket}`)).json);
const onDesk = async (ticket: string, act: string, body: object = {}) => {
  const { revision } = await read(ticket);
  const answer = await desk().call("POST", `/desk/reports/${ticket}/${act}`, { revision, ...body });
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
};

// A report whose number said yes, its first document sent.
async function listening(answers: Parameters<typeof sent>[1] = []) {
  const one = open();
  const ticket = await sent(one, answers);
  await one.send("ya");
  await drain(one);
  return { one, ticket };
}

describe("asked once, and no until said (AC-01)", () => {
  test("the question comes with the first report, and nothing is sent before a yes", async () => {
    const one = open();
    await known(one);
    await reach(one, /^\*Ringkasan laporan/m);
    const { text } = await one.send("1");
    expect(text).toMatch(
      /\*Mau menerima dokumen dan kabar laporan di chat ini\?\*[\s\S]*Balas \*ya\* atau \*tidak\*\.$/,
    );
    const ticket = (/LA-\d{6}-\d{2,}/.exec(text) as RegExpExecArray)[0];
    await onDesk(ticket, "view");
    await onDesk(ticket, "replies", { text: "Terima kasih" });
    expect(await waiting(one)).toEqual([]);
    expect((await read(ticket)).chatNews).toEqual({ wanted: false, waiting: 0, lastSentAt: null });
    expect((await read(ticket)).replies[0]?.chat).toBeNull();
    // A number is no word given: the "1" that sent the report, sent twice, agrees to nothing.
    for (const text of ["1", "2", "3"]) expect((await one.send(text)).text, text).toMatch(/^\*Mau menerima dokumen/);
    expect((await one.send("tidak")).text).toMatch(/^Tidak ada kabar yang dikirim di chat ini/);
    expect(await waiting(one)).toEqual([]);
    // Never asked again.
    await one.send("lapor");
    await one.share(5.14705, 97.0482);
    await one.send("1");
    await reach(one, /^\*Ringkasan laporan/m);
    expect((await one.send("1")).text).not.toContain("Mau menerima");
    const said = await query<{ choice: string }>`select c.choice from news_choice c
      join reporter r on r.number_key = c.number_key where r.number = ${one.number} order by c.id`;
    expect(said.map((row) => row.choice)).toEqual(["asked", "no"]);
  });

  test("words in place of an answer leave it at no", async () => {
    const one = open();
    await sent(one);
    expect((await one.send("terima kasih")).text).toMatch(/^Sama-sama/);
    expect((await one.send("1")).text).toMatch(/Ketik salah satu/);
    expect(await waiting(one)).toEqual([]);
  });
});

describe("the document (AC-02, AC-06)", () => {
  test("comes on a yes, opens, names nobody, and is sent once", async () => {
    const one = open();
    const ticket = await sent(one);
    const { text } = await one.send("ya");
    expect(text).toMatch(/^Kabar dinyalakan[\s\S]*Dokumen LA-\d{6}-\d{2,} versi 1 menyusul di chat ini\.$/);
    const [item, ...rest] = await waiting(one);
    expect(rest).toEqual([]);
    expect(item).toMatchObject({
      number: one.number.slice(1),
      kind: "document",
      ticketNumber: ticket,
      text: `*Dokumen laporan ${ticket}, versi 1*\nNama dan nomor Anda tidak dimuat.`,
    });
    const answer = await file(item);
    expect(answer.headers.get("content-type")).toBe("application/pdf");
    const words = pdfText(new Uint8Array(await answer.arrayBuffer()));
    expect(words).toContain(ticket);
    expect(words).not.toContain("Uji Satu");
    expect(words).not.toContain(one.number.slice(3));
    // Anyone but a gateway that signs is refused, and so is a gateway no longer known.
    expect(
      (await fetchApi(new Request(item?.url as string, { headers: { "cf-connecting-ip": "203.0.113.9" } }))).status,
    ).toBe(401);
    const { bindings: without } = testBindings({ GATEWAY_SECRETS: other }, { clock });
    const taken = gateway((request) => api.app.fetch(request, without), { now: clock.now });
    expect((await taken.request("GET", path(item))).status).toBe(401);
    expect(await mark(item?.id as string)).toBe(200);
    expect(await waiting(one)).toEqual([]);
    expect((await file(item)).status).toBe(404);
    expect(await mark(item?.id as string)).toBe(404);
    expect(await query`select gateway_id from notice_delivery where notice_id = ${Number(item?.id)}`).toEqual([
      { gateway_id: "uji-1" },
    ]);
    expect((await machine.call("GET", "/gateway/news/999999/document")).status).toBe(404);
    expect(await mark("999999")).toBe(404);
    expect((await machine.call("GET", "/gateway/news/x/document")).status).toBe(400);
  });

  test("is asked for whatever was chosen, once while it waits", async () => {
    const one = open();
    expect((await one.send("dokumen")).text).toContain("1. Setuju");
    const ticket = await sent(one);
    await one.send("tidak");
    expect((await one.send("dokumen")).text).toBe(`Dokumen ${ticket} versi 1 menyusul di chat ini.`);
    await one.send(`pdf ${ticket}`);
    const [item, ...rest] = await waiting(one);
    expect(rest).toEqual([]);
    await mark(item?.id as string);
    expect((await one.send("dokumen LA-010101-99")).text).toMatch(/^Laporan LA-010101-99 tidak ditemukan/);
    await one.send("lapor");
    expect((await one.send("dokumen")).text).toMatch(/versi 1 menyusul[\s\S]*\*Lokasi kejadian\*/);
    expect(await waiting(one)).toHaveLength(1);
    await one.send("berhenti kabar");
    expect(await waiting(one)).toEqual([]);
  });

  test("there is none before a report, and no more than 120 an hour", async () => {
    const one = open();
    await known(one);
    expect((await one.send("dokumen")).text).toMatch(/^Belum ada laporan terkirim dari chat ini/);
    const { one: full } = await listening();
    const [counter] = await query<{ subject_key: string; window_start: string }>`
      select subject_key, window_start from rate_counter where limit_id = 'document.hour' order by rowid desc limit 1`;
    await full.send("dokumen");
    const [mine] = await query<{ subject_key: string }>`
      select subject_key from rate_counter where limit_id = 'document.hour' order by rowid desc limit 1`;
    await query`update rate_counter set count = 120 where limit_id = 'document.hour' and subject_key = ${mine?.subject_key}`;
    expect(counter?.subject_key).toBeDefined();
    expect((await full.send("dokumen")).text).toMatch(/^Batas dokumen untuk nomor ini tercapai\. Minta lagi pukul/);
  });

  test("a new version of the reporter's own brings its document", async () => {
    const { one, ticket } = await listening();
    await one.send("kabar");
    await one.send("lima rumah rusak berat");
    expect((await one.send("1")).text).toBe(
      `*Kabar terkirim*\nLaporan ${ticket} sekarang versi 2.\n\nDokumen ${ticket} versi 2 menyusul di chat ini.`,
    );
    expect((await waiting(one)).map((item) => item.text)).toEqual([
      `*Dokumen laporan ${ticket}, versi 2*\nNama dan nomor Anda tidak dimuat.`,
    ]);
  });
});

describe("what staff do (AC-03, AC-05)", () => {
  test("a reply, then a close with its actions: one message each, with no officer's name", async () => {
    const { one, ticket } = await listening();
    await onDesk(ticket, "view");
    await onDesk(ticket, "replies", { text: "Terima kasih, kami cek." });
    const [seen, reply, ...rest] = await waiting(one);
    expect(rest).toEqual([]);
    expect([seen?.kind, seen?.url]).toEqual(["status", null]);
    expect(seen?.text).toMatch(
      new RegExp(
        `^\\*Kabar laporan ${ticket}\\*\\n25 November 2026, pukul \\d\\d\\.\\d\\d WIB\\n\\nStatus: Sudah dilihat petugas\\n\\nKetik \\*berhenti kabar\\* untuk berhenti\\.$`,
      ),
    );
    expect(reply?.kind).toBe("reply");
    expect(reply?.text).toContain("Status: Sedang ditelaah\n\n*Balasan petugas*\nTerima kasih, kami cek.");
    expect((await read(ticket)).replies[0]?.chat).toEqual({ state: "waiting" });
    expect((await read(ticket)).chatNews).toMatchObject({ wanted: true, waiting: 3 });
    await drain(one);
    const told = await read(ticket);
    expect(told.replies[0]?.chat).toMatchObject({ state: "sent", at: { zone: "WIB" } });
    expect(told.chatNews).toMatchObject({ waiting: 0, lastSentAt: { zone: "WIB" } });
    const actions = told.offeredActions.slice(0, 2).map((action) => action.code);
    await onDesk(ticket, "status", { to: "in_handling", note: "Tim berangkat", actions, otherAction: "Dapur umum" });
    await onDesk(ticket, "status", { to: "closed", note: "Sudah surut semuanya" });
    const [handled, closed] = await waiting(one);
    expect(handled?.text).toContain("Status: Ditindaklanjuti\n\n*Tindakan petugas*\n• ");
    expect(handled?.text).toContain("• Dapur umum");
    expect(closed?.text).toMatch(/Status: Selesai ditangani\n\nLacak laporan: http:\/\/localhost:5173\/track#t=/);
    for (const item of [handled, closed]) {
      expect(item?.text).not.toContain("Petugas Uji");
      expect(item?.text).not.toContain("Tim berangkat");
      expect(item?.text).not.toContain("Sudah surut");
    }
    const status = (await one.send(`status ${ticket}`)).text;
    expect(status).toMatch(/Status: Selesai ditangani[\s\S]*Dapur umum[\s\S]*\*Balasan petugas\*\nTerima kasih/);
  });

  test("a report set aside tells the reason", async () => {
    const { one, ticket } = await listening();
    await onDesk(ticket, "view");
    await drain(one);
    await onDesk(ticket, "status", { to: "invalid", note: "Kejadian tahun lalu" });
    const [item] = await waiting(one);
    expect(item?.text).toContain("Status: Tidak dapat ditindaklanjuti\nAlasan: Kejadian tahun lalu");
    expect((await one.send(`status ${ticket}`)).text).toContain("Alasan: Kejadian tahun lalu");
  });

  test("a check that put a value right is told with the new document", async () => {
    const { one, ticket } = await listening([[/• Meninggal/, "3 0 0"]]);
    await onDesk(ticket, "view");
    await drain(one);
    const boxes = Object.fromEntries(
      (await read(ticket)).revisable.map((one) => [one.fieldId, String(one.count ?? "")]),
    );
    await onDesk(ticket, "checks", { result: "partly", note: "Dua di lokasi", boxes: { ...boxes, dead: "2" } });
    const [item, ...rest] = await waiting(one);
    expect(rest).toEqual([]);
    expect(item?.kind).toBe("document");
    expect(item?.text).toContain("*Koreksi petugas di lapangan*\n• Meninggal: 3 orang menjadi 2 orang");
    expect(item?.text).not.toContain("Dua di lokasi");
    const words = pdfText(new Uint8Array(await (await file(item)).arrayBuffer()));
    expect(words).toContain("2 orang");
    expect((await one.send(`status ${ticket}`)).text).toContain("Meninggal: 3 orang menjadi 2 orang");
  });

  test("a long list is cut", async () => {
    const { one, ticket } = await listening();
    await onDesk(ticket, "view");
    await onDesk(ticket, "status", { to: "under_review", note: "" });
    await onDesk(ticket, "status", { to: "in_handling", note: "", actions: [], otherAction: "Tindakan 0" });
    await drain(one);
    const [history] = await query<{
      id: number;
    }>`select max(id) as id from ticket_history where ticket_number = ${ticket}`;
    const actions = JSON.stringify({ actions: Array.from({ length: 10 }, (_, n) => `Tindakan ${n + 1}`) });
    await query`insert into ticket_history (ticket_number, from_status, to_status, actor, actor_id, actor_label, at, event, detail)
      values (${ticket}, 'in_handling', 'in_handling', 'staff', 's', 'Uji', ${new Date(clock.now())}, 'actions', ${actions})`;
    await query`insert into notice (ticket_number, kind, history_id, at)
      select ${ticket}, 'actions', max(id), ${new Date(clock.now())} from ticket_history where ticket_number = ${ticket}`;
    expect(history?.id).toBeGreaterThan(0);
    const [item] = await waiting(one);
    expect(item?.text).toContain("• Tindakan 8\n• dan 2 lagi");
  });
});

describe("stopped and started (AC-04)", () => {
  test("what waits is not sent, and after it starts again only what happens later is", async () => {
    const { one, ticket } = await listening();
    await onDesk(ticket, "view");
    expect(await waiting(one)).toHaveLength(1);
    expect((await one.send("berhenti kabar")).text).toMatch(/^Tidak ada kabar yang dikirim di chat ini/);
    await one.send("berhenti kabar");
    expect(await waiting(one)).toEqual([]);
    expect((await read(ticket)).chatNews).toMatchObject({ wanted: false, waiting: 0 });
    await onDesk(ticket, "replies", { text: "Saat berhenti" });
    expect((await one.send("nyalakan kabar")).text).toMatch(/^Kabar dinyalakan/);
    await one.send("nyalakan kabar");
    expect(await waiting(one)).toEqual([]);
    await onDesk(ticket, "replies", { text: "Sesudah menyala" });
    const items = await waiting(one);
    expect(items.map((item) => item.text.includes("Sesudah menyala"))).toEqual([true]);
    await one.send("lapor");
    expect((await one.send("berhenti kabar")).text).toMatch(/^Tidak ada kabar[\s\S]*\*Lokasi kejadian\*/);
  });

  test("stopped for one report on the web, that report's news is not sent", async () => {
    const { one, ticket } = await listening();
    await onDesk(ticket, "view");
    const [report] = await query<{ id: string }>`select id from report where ticket_number = ${ticket}`;
    await query`insert into report_news (report_id, read_at, stopped, changed_at)
      values (${report?.id}, ${new Date(clock.now())}, 1, ${new Date(clock.now())})`;
    expect(await waiting(one)).toEqual([]);
    await onDesk(ticket, "replies", { text: "Tidak dikabarkan" });
    expect((await read(ticket)).replies.map((reply) => reply.chat)).toEqual([null]);
  });
});

describe("what never goes to a chat", () => {
  test("news of a report some phone typed the number for (AC-07)", async () => {
    const { one, ticket } = await listening();
    await query`update report set owner_slot = 'a-phone', number_unverified = 1 where ticket_number = ${ticket}`;
    await onDesk(ticket, "view");
    expect(await waiting(one)).toEqual([]);
    await query`update report set owner_slot = 'session' where ticket_number = ${ticket}`;
    expect(await waiting(one)).toEqual([]);
  });

  test("news nobody came for in a week", async () => {
    const { one, ticket } = await listening();
    await onDesk(ticket, "view");
    const [item] = await waiting(one);
    clock.advance(7 * 86_400_000);
    expect(await waiting(one)).toEqual([]);
    expect(await mark(item?.id as string)).toBe(404);
  });

  test("a report of the web says nothing of WhatsApp on the desk", async () => {
    const { ticket } = await listening();
    await query`update report set door = 'web' where ticket_number = ${ticket}`;
    expect((await read(ticket)).chatNews).toBeNull();
  });
});

test("more waiting than one pull takes is told act by act, the last whole the next time", async () => {
  const { one, ticket } = await listening();
  const rows = Array.from({ length: 60 }, (_, n) => n);
  for (const n of rows)
    await query`insert into notice (ticket_number, kind, version, at)
      values (${ticket}, 'document', 1, ${new Date(clock.now() + Math.floor(n / 2) * 1000)})`;
  clock.advance(120_000);
  const first = await waiting(one);
  expect(first).toHaveLength(24);
  for (const item of first) expect(await mark(item.id)).toBe(200);
  expect(await waiting(one)).toHaveLength(6);
});

test("a number that has been asked is not asked again by its news", async () => {
  const one = open();
  const ticket = await sent(one);
  await one.send("terima kasih");
  await one.send(`kabar ${ticket}`);
  await one.send("lima rumah rusak berat");
  expect((await one.send("1")).text).toBe(`*Kabar terkirim*\nLaporan ${ticket} sekarang versi 2.`);
});
