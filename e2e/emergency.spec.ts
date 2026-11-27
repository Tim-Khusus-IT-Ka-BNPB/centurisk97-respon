import { readFileSync } from "node:fs";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { exifDateTime, withExif } from "../src/testing/jpegs.ts";
import {
  answerCard,
  closeOthers,
  liveCard,
  nextCard,
  noSidewaysScroll,
  ownAddress,
  paced,
  searchPlace,
  syntheticNumber,
} from "./support.ts";

const DESK_CODE = "seeded-session-desk-officer-local-only";
const REGENCY_CODE = "seeded-session-bpbd-regency-local-only";
const PROVINCE_CODE = "seeded-session-bpbd-province-local-only";
// Inside the seed outline of Desa Cot Seumiyong, Aceh Utara.
const HERE = { latitude: 5.14705, longitude: 97.0482, accuracy: 15 };

test.beforeEach(async ({ context }) => ownAddress(context));
test.afterEach(async ({ browser, context }) => closeOthers(browser, context));

async function deskPage(browser: Browser, code: string, baseURL: string): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  await ownAddress(context);
  const desk = await context.newPage();
  await desk.goto("/desk", { waitUntil: "networkidle" });
  await desk.getByLabel("Kode masuk").fill(code);
  await expect(desk.getByLabel("Kode masuk")).toHaveValue(code);
  await desk.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(desk.getByRole("heading", { level: 1, name: "Peta laporan" })).toBeVisible();
  return desk;
}

// "Lapor darurat" from the home: identity and consent as usual.
async function startEmergency(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: "Lapor darurat" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lapor darurat" })).toBeVisible();
  await page.getByLabel("Warga").check();
  await page.getByLabel("Nama").fill("Uji Satu");
  await page.getByLabel("WhatsApp").fill(syntheticNumber());
  await page.getByRole("button", { name: "Setuju", exact: true }).click();
  await page.getByRole("button", { name: "Ya", exact: true }).click();
  await expect(liveCard(page)).toHaveAttribute("data-card-kind", "placeSearch");
}

test("an emergency takes a place, what happened, victims and a send, and the desk alarms for it", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  const script = !info.project.name.includes("no-script");
  const desk = script ? await deskPage(browser, DESK_CODE, baseURL as string) : null;
  await startEmergency(page);
  await noSidewaysScroll(page);
  let cardId = await liveCard(page).getAttribute("data-card-id");
  await searchPlace(page, "cot seumiyong");
  await paced(() => liveCard(page).locator('button[name="villageCode"]').first().click());
  cardId = await nextCard(page, cardId);
  await expect(liveCard(page).getByText("Kejadian apa yang sedang terjadi?")).toBeVisible();
  await paced(() =>
    liveCard(page)
      .getByRole("button", { name: /^Banjir/ })
      .click(),
  );
  cardId = await nextCard(page, cardId);
  await expect(liveCard(page).getByText("Ada orang terluka, hilang, atau terjebak?")).toBeVisible();
  await noSidewaysScroll(page);
  await paced(() => liveCard(page).getByRole("button", { name: "Ya, ada" }).click());
  cardId = await nextCard(page, cardId);
  // With victims, who is still trapped and who needs medical help (K94, K98).
  await expect(liveCard(page).getByText(/terjebak atau terseret air/)).toBeVisible();
  await paced(() =>
    liveCard(page)
      .getByRole("button", { name: /^Ya, ada yang terlihat/ })
      .click(),
  );
  cardId = await nextCard(page, cardId);
  await paced(() =>
    liveCard(page)
      .getByRole("button", { name: /^Ada luka berat/ })
      .click(),
  );
  cardId = await nextCard(page, cardId);
  await expect(liveCard(page)).toHaveAttribute("data-card-kind", "photos");
  await paced(() => answerCard(liveCard(page), "photos"));
  cardId = await nextCard(page, cardId);
  await expect(liveCard(page).getByText("Laporan darurat, sedang berlangsung")).toBeVisible();
  await noSidewaysScroll(page);
  await paced(() => liveCard(page).getByRole("button", { name: "Kirim", exact: true }).click());
  await nextCard(page, cardId);
  await expect(liveCard(page)).toHaveAttribute("data-card-kind", "sent");

  // The desk page that was already open alarms within 20 seconds; opening the report ends it.
  if (desk === null) return;
  const newest = desk
    .getByRole("region", { name: /laporan darurat belum dibuka/ })
    .getByRole("link")
    .filter({ hasText: "ada korban" })
    .first();
  await expect(newest).toBeVisible({ timeout: 25_000 });
  await noSidewaysScroll(desk);
  await desk.screenshot({ path: info.outputPath("alarm.png") });
  const address = (await newest.getAttribute("href")) as string;
  await newest.click();
  await expect(desk).toHaveURL(new RegExp(address));
  await expect(desk.locator("header").getByText("Darurat", { exact: true }).first()).toBeVisible();
  await expect(desk.locator(`section a[href="${address}"]`)).toHaveCount(0);
});

test("one tap shows who to call before the phone is read, and is for a reporter known here", async ({
  page,
  browser,
  baseURL,
  context,
}, info) => {
  test.setTimeout(120_000);
  test.skip(info.project.name.includes("no-script"), "one tap needs script");
  // Nobody known here: the way leads to the short conversation.
  await page.goto("/emergency");
  await expect(page).toHaveURL(/\/report\?emergency=1$/);
  await startEmergency(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(HERE);
  // One tap is no longer offered on the home page; its page opens it.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Darurat sekali ketuk" })).toHaveCount(0);
  await page.goto("/emergency?ketuk=1");
  for (const phone of ["112", "117"]) await expect(page.locator(`a[href="tel:${phone}"]`).first()).toBeVisible();
  await expect(page.getByText(/Terkirim ke meja BNPB dengan nomor LA-/)).toBeVisible({ timeout: 40_000 });
  await expect(page.getByRole("link", { name: /^BPBD Aceh Utara/ })).toBeVisible();
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath("one-tap.png"), fullPage: true });
  const ticket = /LA-\d{6}-\d{2,}/.exec((await page.getByRole("status").textContent()) ?? "")?.[0] as string;

  // A second tap is refused with the time it opens again.
  await page.goto("/emergency?ketuk=1");
  await expect(page.getByText(/sudah terkirim dari ponsel ini. Bisa dikirim lagi mulai/)).toBeVisible({
    timeout: 40_000,
  });

  // Its own regency's desk alarms; another province's never does.
  const own = await deskPage(browser, REGENCY_CODE, baseURL as string);
  await expect(own.locator(`a[href="/desk/${ticket}"]`).first()).toBeVisible();
  const other = await deskPage(browser, PROVINCE_CODE, baseURL as string);
  await expect(other.locator(`a[href="/desk/${ticket}"]`)).toHaveCount(0);
});

test("with no signal one tap is kept on the phone with a camera photo, and both reach the desk when signal returns", async ({
  page,
  browser,
  baseURL,
  context,
}, info) => {
  test.setTimeout(120_000);
  test.skip(info.project.name.includes("no-script"), "one tap needs script");
  await startEmergency(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(HERE);
  await page.goto("/emergency");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Kirim titik lokasi sekarang" }).click();
  await expect(page.getByText(/^Tidak ada sinyal\./)).toBeVisible();
  const base = new Uint8Array(readFileSync("db/synthetic/photo-base.jpg"));
  const photo = withExif(base, { make: "Uji", model: "Kamera", dateTime: exifDateTime(Date.now() - 10_000, 420) });
  await page
    .getByLabel("Ambil foto")
    .setInputFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer: Buffer.from(photo) });
  await expect(page.getByRole("button", { name: "Hapus foto 1" })).toBeVisible();
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath("kept-photo.png"), fullPage: true });

  // Signal returns; the button sends at once where the browser does not say so itself.
  await context.setOffline(false);
  const sendNow = page.getByRole("button", { name: "Kirim sekarang" });
  // It may have gone on its own meanwhile, taking the button with it.
  if (await sendNow.isVisible()) await sendNow.click({ timeout: 2000 }).catch(() => undefined);
  await expect(page.getByText(/Terkirim ke meja BNPB dengan nomor LA-/)).toBeVisible({ timeout: 40_000 });
  const ticket = /LA-\d{6}-\d{2,}/.exec((await page.getByRole("status").textContent()) ?? "")?.[0] as string;
  const desk = await deskPage(browser, DESK_CODE, baseURL as string);
  await desk.goto(`/desk/${ticket}`);
  const photos = desk.getByRole("region", { name: "Foto pelapor" });
  await expect(photos.getByRole("img")).toHaveCount(1);
});
