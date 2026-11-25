import { readFileSync } from "node:fs";
import { type Browser, type Download, expect, type Page, test } from "@playwright/test";
import { liveCard, noSidewaysScroll, ownAddress, paced, syntheticNumber } from "./support.ts";

const DESK_CODE = "seeded-session-desk-officer-local-only";

test.beforeEach(async ({ context }) => ownAddress(context));

type Draft = { draftId: string; revision: number; card: { kind: string; cardId: string; options?: { id: string }[] } };

// An emergency is the shortest report there is, so it is sent through the API from this browser's
// own context: what follows is about the report once sent.
async function sendEmergency(page: Page, baseURL: string): Promise<string> {
  const call = async <T>(method: "GET" | "POST", path: string, data?: unknown): Promise<T> => {
    const response = await page.request.fetch(`/api/lapor${path}`, {
      method,
      headers: { origin: baseURL, "x-lapor-client": "1", "cf-connecting-ip": "10.77.0.1" },
      ...(data === undefined ? {} : { data }),
    });
    expect(response.status(), `${method} ${path}`).toBeLessThan(300);
    return (await response.json()) as T;
  };
  const village = (await call<{ items: { code: string }[] }>("GET", "/places/regencies/11.08/villages?q=")).items[0]
    ?.code as string;
  let draft = await call<Draft>("POST", "/consent", {
    role: "citizen",
    name: "Uji Satu",
    number: syntheticNumber(),
    privacyVersion: 1,
    agree: true,
    emergency: true,
  });
  const answers: Record<string, Record<string, unknown>> = {
    placeSearch: { villageCode: village },
    photos: { optionIds: ["cannotSend"] },
  };
  while (draft.card.kind !== "summary")
    draft = await call<Draft>("POST", `/drafts/${draft.draftId}/turns`, {
      revision: draft.revision,
      turnKey: crypto.randomUUID(),
      cardId: draft.card.cardId,
      kind: "answer",
      ...(answers[draft.card.kind] ?? { optionIds: [draft.card.options?.[0]?.id] }),
    });
  const sent = await call<{ ticketNumber: string }>("POST", `/drafts/${draft.draftId}/send`, {
    revision: draft.revision,
    turnKey: crypto.randomUUID(),
  });
  return sent.ticketNumber;
}

async function deskPage(browser: Browser, baseURL: string, script: boolean): Promise<Page> {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: script, acceptDownloads: true });
  await ownAddress(context);
  const desk = await context.newPage();
  await desk.goto("/lapor/meja", { waitUntil: "networkidle" });
  await desk.getByLabel("Kode masuk").fill(DESK_CODE);
  await expect(desk.getByLabel("Kode masuk")).toHaveValue(DESK_CODE);
  await desk.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(desk.getByRole("heading", { level: 1, name: "Peta laporan" })).toBeVisible();
  return desk;
}

async function saved(page: Page, press: () => Promise<void>): Promise<{ name: string; start: string }> {
  const coming = page.waitForEvent("download");
  await press();
  const download: Download = await coming;
  const bytes = readFileSync(await download.path());
  return { name: download.suggestedFilename(), start: bytes.subarray(0, 4).toString("latin1") };
}

test("a sent report is downloaded, added to, and answered by staff, each on its own page", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  const script = !info.project.name.includes("no-script");
  const ticket = await sendEmergency(page, baseURL as string);

  // "Laporan saya" leads to the report.
  await page.goto("/lapor");
  await page.getByRole("link", { name: new RegExp(ticket) }).click();
  await expect(page.getByRole("heading", { level: 1, name: ticket })).toBeVisible();
  await noSidewaysScroll(page);
  const documents = page.getByRole("region", { name: "Dokumen laporan" });
  expect(await saved(page, () => documents.getByRole("link", { name: "Unduh PDF versi 1" }).click())).toEqual({
    name: `Laporan ${ticket} versi 1.pdf`,
    start: "%PDF",
  });
  expect(await saved(page, () => documents.getByRole("link", { name: "Unduh Word versi 1" }).click())).toEqual({
    name: `Laporan ${ticket} versi 1.docx`,
    start: "PK\u0003\u0004",
  });

  // News: one group, then the send, and the report has a second version that names the change.
  await paced(() => page.getByRole("button", { name: "Tambah kabar" }).click());
  await expect(liveCard(page).getByRole("heading", { name: `Tambah kabar untuk ${ticket}` })).toBeVisible();
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath("follow-up.png"), fullPage: true });
  await paced(() => liveCard(page).getByRole("button", { name: "Kirim kabar" }).click());
  await expect(liveCard(page).getByRole("alert")).toContainText("Belum ada yang berubah");
  await paced(() => liveCard(page).getByRole("button", { name: "Ubah Korban" }).click());
  await liveCard(page).getByLabel("Meninggal").fill("2");
  await paced(() => liveCard(page).getByRole("button", { name: "Simpan jawaban" }).click());
  const news = page.getByRole("region", { name: "Yang akan dikirim" });
  await expect(news.getByRole("listitem")).toHaveText("Meninggal: belum didata menjadi 2 orang");
  await paced(() => news.getByRole("button", { name: "Kirim kabar" }).click());
  await expect(page.getByRole("heading", { level: 1, name: ticket })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Kabar terkirim. Laporan ini sekarang versi 2.");
  await expect(documents.getByText("Meninggal: belum didata menjadi 2 orang")).toBeVisible();
  await noSidewaysScroll(page);

  // The desk: the news stands out, a version is downloaded, and a reply is written.
  const desk = await deskPage(browser, baseURL as string, script);
  await desk.goto(`/lapor/meja/${ticket}`);
  if (!script) await desk.getByRole("button", { name: "Tandai sudah dilihat" }).click();
  await expect(desk.getByRole("region", { name: "Kabar baru dari pelapor, versi 2" })).toContainText("2 orang");
  expect((await saved(desk, () => desk.getByRole("button", { name: "Unduh PDF versi 2" }).click())).name).toBe(
    `Laporan ${ticket} versi 2.pdf`,
  );
  await noSidewaysScroll(desk);
  await desk.screenshot({ path: info.outputPath("desk.png"), fullPage: true });
  const actions = desk.getByRole("region", { name: "Tindak lanjut" });
  await actions.locator("summary", { hasText: "Balas pelapor" }).click();
  await actions.getByLabel("Balasan", { exact: true }).fill("Terima kasih, tim kami berangkat.");
  await actions.getByRole("button", { name: "Kirim balasan" }).click();
  await expect(desk.getByRole("status")).toContainText("Balasan terkirim.");
  await expect(desk.getByRole("region", { name: "Kabar baru dari pelapor, versi 2" })).toHaveCount(0);

  // The reporter sees that there is news, reads it, and stops it.
  await page.goto("/lapor");
  const row = page.getByRole("link", { name: new RegExp(ticket) });
  await expect(row).toContainText("3 kabar baru");
  await row.click();
  const own = page.getByRole("region", { name: /^Kabar petugas/ });
  await expect(own.getByText("Terima kasih, tim kami berangkat.")).toBeVisible();
  await expect(own.getByText("Baru", { exact: true })).toHaveCount(3);
  await page.screenshot({ path: info.outputPath("own.png"), fullPage: true });
  if (!script) {
    await own.getByRole("button", { name: "Tandai sudah dibaca" }).click();
    await expect(own.getByText("Baru", { exact: true })).toHaveCount(0);
  } else await page.waitForLoadState("networkidle");
  await page.goto("/lapor");
  await expect(page.getByRole("link", { name: new RegExp(ticket) })).not.toContainText("kabar baru");
  await page.goto(`/lapor/reports/${ticket}`);
  await own.getByRole("button", { name: "Hentikan kabar" }).click();
  await expect(page.getByRole("status")).toHaveText("Kabar untuk laporan ini dihentikan.");
  await own.getByRole("button", { name: "Nyalakan kabar" }).click();
  await expect(page.getByRole("status")).toHaveText("Kabar untuk laporan ini dinyalakan lagi.");
  await noSidewaysScroll(page);

  // Another phone is told there is no such report.
  const stranger = await browser.newContext({ baseURL: baseURL as string });
  await ownAddress(stranger);
  const other = await stranger.newPage();
  const answer = await other.goto(`/lapor/reports/${ticket}`);
  expect(answer?.status()).toBe(401);
  await stranger.close();
  await desk.context().close();
});
