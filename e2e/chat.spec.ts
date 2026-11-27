import { readFileSync } from "node:fs";
import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";
import { noSidewaysScroll, ownAddress } from "./support.ts";

const DESK_CODE = "seeded-session-desk-officer-local-only";
const GATEWAY = `http://127.0.0.1:${process.env.TEST_GATEWAY_PORT ?? "8791"}`;
const PHOTO = readFileSync("db/synthetic/photo-base.jpg").toString("base64");
const VILLAGE = { lat: 5.14705, lon: 97.0482 };

test.beforeEach(async ({ context }) => ownAddress(context));

const synthetic = () => `62800${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

type Entry = { from: string; kind: string; text: string; file?: string };

// One number's phone: what it sends, and what it has received, as the gateway's outbox holds it.
function phone(request: APIRequestContext, number: string) {
  const post = async (body: object): Promise<{ status: number; last: string; chat: Entry[] }> => {
    const response = await request.post(`${GATEWAY}/api/send`, { data: { number, ...body } });
    const { status, chat } = (await response.json()) as { status: number; chat: Entry[] };
    // 20 messages a minute is a number's limit; a person waits, and so does this one.
    if (status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 61_000 - (Date.now() % 60_000)));
      return post(body);
    }
    return { status, last: chat.at(-1)?.text ?? "", chat };
  };
  const received = async (): Promise<Entry[]> => {
    const { chats } = (await (await request.get(`${GATEWAY}/api/outbox`)).json()) as { chats: Record<string, Entry[]> };
    return (chats[number] ?? []).filter((entry) => entry.from === "service");
  };
  return {
    number,
    received,
    say: (text: string, messageId?: string) => post({ text, messageId }),
    share: () => post({ location: VILLAGE }),
    photo: () => post({ photo: PHOTO }),
  };
}

const PLAIN: readonly (readonly [RegExp, string])[] = [
  [/^\*Kejadian yang sama\?/m, "bukan"],
  [/^\*RT dan RW/m, "RT 4 RW 2"],
  [/^\*Jenis bencana/m, "banjir"],
  [/• Meninggal/, "2 0 5"],
  [/^\*Kronologi tersusun/m, "lanjut"],
  [/^\*Waktu kejadian/m, "kemarin pukul 17.00"],
  [/Balas \d angka berurutan/, "tidak ada"],
  [/\*tidak tahu\* bila belum tahu/, "tidak tahu"],
  [/Balas dengan angkanya|Boleh lebih dari satu/, "1"],
];

async function answersTo(one: ReturnType<typeof phone>, until: RegExp): Promise<string> {
  let { last } = await one.say("ulangi");
  for (let turn = 0; turn < 60 && !until.test(last); turn += 1) {
    const answer = PLAIN.find(([question]) => question.test(last));
    expect(answer, last).toBeTruthy();
    ({ last } = await one.say((answer as (typeof PLAIN)[number])[1]));
  }
  return last;
}

async function deskPage(browser: Browser, baseURL: string, script: boolean): Promise<Page> {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: script });
  await ownAddress(context);
  const desk = await context.newPage();
  await desk.goto("/desk", { waitUntil: "networkidle" });
  await desk.getByLabel("Kode masuk").fill(DESK_CODE);
  await desk.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(desk.getByRole("heading", { level: 1, name: "Peta laporan" })).toBeVisible();
  return desk;
}

async function allow(desk: Page, number: string): Promise<void> {
  await desk.goto("/desk/pilot");
  await desk.getByLabel("Nomor WhatsApp").fill(`+${number}`);
  await desk.getByRole("button", { name: "Izinkan nomor" }).click();
  await expect(desk.getByText("Nomor sudah diizinkan.")).toBeVisible();
}

const shown = (number: string) => `+62 ${number.slice(2, 5)}-${number.slice(5, 9)}-${number.slice(9)}`;

test("a report filed in a chat, its document and news received there, and closed at the desk", async ({
  request,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(420_000);
  const script = !info.project.name.includes("no-script");
  const one = phone(request, synthetic());
  const desk = await deskPage(browser, baseURL as string, script);

  // Not allowed: nothing.
  expect((await one.say("banjir")).status).toBe(403);
  expect(await one.received()).toEqual([]);
  await allow(desk, one.number);
  await noSidewaysScroll(desk);
  await expect(desk.getByText(shown(one.number))).toBeVisible();

  // Who reports.
  expect((await one.say("banjir di kampung kami")).last).toContain("1. Setuju");
  for (const text of ["1", "1", "Uji Satu"]) await one.say(text);
  expect((await one.share()).last).toContain("Lokasi dibagikan lewat WhatsApp");
  expect((await one.say("ya")).last).toContain("*RT dan RW*");

  // A replayed message is refused, and answers nothing.
  const replayed = crypto.randomUUID();
  expect((await one.say("ulangi", replayed)).status).toBe(200);
  const before = (await one.received()).length;
  expect((await one.say("ulangi", replayed)).status).toBe(409);
  expect(await one.received()).toHaveLength(before);

  expect(await answersTo(one, /^\*Foto kejadian/m)).toContain("1. Lanjut tanpa foto");
  expect((await one.photo()).last).toMatch(/Foto 1 dari 10 diterima/);
  expect((await one.say("1")).last).toContain("Meninggal: 2 orang");
  const { last: sent } = await one.say("1");
  const ticket = /LA-\d{6}-\d{2,}/.exec(sent)?.[0] as string;
  expect(ticket, sent).toBeTruthy();

  // The document, after a yes.
  expect((await one.say("ya")).last).toContain("menyusul di chat ini");
  await expect.poll(async () => (await one.received()).filter((entry) => entry.kind === "document").length).toBe(1);
  const document = (await one.received()).find((entry) => entry.kind === "document");
  const pdf = await (await request.get(`${GATEWAY}${document?.file}`)).body();
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // At the desk: through WhatsApp, answered, handled and closed, each told in the chat.
  const told = (words: string) =>
    expect.poll(async () => (await one.received()).filter((entry) => entry.text.includes(words)).length).toBe(1);
  await desk.goto(`/desk/${ticket}`, { waitUntil: "networkidle" });
  const header = desk.locator("header").filter({ has: desk.getByRole("heading", { level: 1, name: ticket }) });
  await expect(header.getByText("Lewat WhatsApp")).toBeVisible();
  if (!script) await desk.getByRole("button", { name: "Tandai sudah dilihat" }).click();
  await expect(header.getByText("Dilihat", { exact: true })).toBeVisible();
  await told("Status: Sudah dilihat petugas");
  const actions = desk.getByRole("region", { name: "Tindak lanjut" });
  await actions.locator("summary", { hasText: "Balas pelapor" }).click();
  await expect(actions.getByText("Balasan dan kabar tiket ini dikirim ke WhatsApp pelapor.")).toBeVisible();
  await actions.getByLabel("Balasan").fill("Terima kasih, tim kami menuju lokasi.");
  await actions.getByRole("button", { name: "Kirim balasan" }).click();
  await expect(desk.getByRole("status")).toContainText("Balasan terkirim.");
  await told("*Balasan petugas*\nTerima kasih, tim kami menuju lokasi.");
  await actions.getByRole("radio", { name: "Ditindaklanjuti", exact: true }).check();
  await actions.getByLabel("Evakuasi warga").check();
  await actions.locator("#note").fill("Tim berangkat");
  await actions.getByRole("button", { name: "Simpan status" }).click();
  await expect(header.getByText("Ditindaklanjuti", { exact: true })).toBeVisible();
  await told("*Tindakan petugas*\n• Evakuasi warga");
  await actions.getByRole("radio", { name: "Selesai ditangani", exact: true }).check();
  await actions.locator("#note").fill("Air sudah surut");
  await actions.getByRole("button", { name: "Simpan status" }).click();
  await expect(header.getByText("Selesai", { exact: true })).toBeVisible();
  await told("Status: Selesai ditangani");
  const all = (await one.received()).map((entry) => entry.text).join("\n");
  for (const kept of ["Petugas Uji", "Tim berangkat", "Air sudah surut"]) expect(all).not.toContain(kept);
  expect((await one.say(`status ${ticket}`)).last).toMatch(/Selesai ditangani[\s\S]*tim kami menuju lokasi/);
  await noSidewaysScroll(desk);

  // Taken off the list: silence.
  await desk.goto("/desk/pilot");
  await desk.getByLabel(`Cabut izin ${shown(one.number)}`).click();
  const row = desk.getByRole("listitem").filter({ hasText: shown(one.number) });
  await row.getByRole("button", { name: "Cabut izin" }).click();
  await expect(desk.getByText("Izin nomor sudah dicabut.")).toBeVisible();
  const heard = (await one.received()).length;
  expect((await one.say("status")).status).toBe(403);
  expect(await one.received()).toHaveLength(heard);
});

test("the owner's command and the chat page of the test gateway", async ({ page, request }, info) => {
  test.skip(info.project.name.includes("no-script"), "the chat page is a tool of this machine and needs script");
  const number = synthetic();
  const owner = phone(request, "6280000000000");
  expect((await owner.say(`lapor izin ${number} bpbd Kabupaten Uji`)).status).toBe(200);
  await page.goto(GATEWAY);
  await page.getByLabel("Write as a number").fill("12");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("begins with 0800");
  await page.getByLabel("Write as a number").fill(`0${number.slice(2)}`);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByLabel("Message").fill("lapor");
  await page.getByRole("button", { name: "Send" }).click();
  const messages = page.locator("#messages");
  await expect(messages).toContainText("Apakah Anda setuju?");
  for (const text of ["1", "2", "Uji Dua", "Kabupaten Uji", "Staf"]) {
    await page.getByLabel("Message").fill(text);
    await page.getByLabel("Message").press("Enter");
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  }
  await expect(messages).toContainText("Lokasi kejadian");
  await page.getByRole("button", { name: "Location" }).click();
  await page.getByRole("button", { name: "Share location" }).click();
  await expect(messages).toContainText("Lokasi dibagikan lewat WhatsApp");
  await noSidewaysScroll(page);
  expect((await owner.say(`lapor cabut ${number}`)).status).toBe(200);
});
