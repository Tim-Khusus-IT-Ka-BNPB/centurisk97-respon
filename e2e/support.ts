import { type Browser, type BrowserContext, expect, type Locator, type Page } from "@playwright/test";

// Every test reports from its own address, so the per-address limits of one run never meet
// another's. Locally the dev server passes the header through unchanged. Only our own host gets
// it: on a request to another host (the map tiles) it would force a preflight that host refuses.
export async function ownAddress(context: BrowserContext): Promise<void> {
  const part = () => Math.floor(Math.random() * 250) + 1;
  const address = `10.${part()}.${part()}.${part()}`;
  await context.route(
    (url) => url.hostname === "localhost",
    (route) => route.continue({ headers: { ...route.request().headers(), "cf-connecting-ip": address } }),
  );
}

// What a test opened beside its own page. Left open, a desk's live map and its alarm go on in the
// same browser and slow every test after it.
export async function closeOthers(browser: Browser, own: BrowserContext): Promise<void> {
  await Promise.all(browser.contexts().map((context) => (context === own ? undefined : context.close())));
}

// A synthetic number in the 0800 range, new for each run.
export const syntheticNumber = () => `0800${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

export const liveCard = (page: Page): Locator => page.locator("[data-card-kind]").last();

export async function noSidewaysScroll(page: Page): Promise<void> {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
}

// Fills the identity and consent form and stores it through the read-back.
export async function startReport(page: Page, name: string, number: string): Promise<void> {
  await page.goto("/lapor");
  await page.getByRole("link", { name: "Lapor kejadian" }).click();
  await expect(page.getByRole("heading", { name: "Data pelapor" })).toBeVisible();
  await page.getByLabel("Warga").check();
  await page.getByLabel("Nama").fill(name);
  await page.getByLabel("WhatsApp").fill(number);
  await page.getByRole("button", { name: "Setuju", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Periksa nomor Anda" })).toBeVisible();
  await page.getByRole("button", { name: "Ya", exact: true }).click();
  await expect(liveCard(page)).toHaveAttribute("data-card-kind", "placeSearch");
}

// Turns are paced so the 20-a-minute message limit is never reached on one number.
const PACE_MS = 3100;
let lastTurn = 0;
export async function paced(action: () => Promise<void>): Promise<void> {
  const wait = lastTurn + PACE_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastTurn = Date.now();
  await action();
}

// Waits until the live card is a different one from before.
export async function nextCard(page: Page, previousId: string | null): Promise<string> {
  await expect.poll(async () => liveCard(page).getAttribute("data-card-id"), { timeout: 15_000 }).not.toBe(previousId);
  return (await liveCard(page).getAttribute("data-card-id")) as string;
}

// The reporter's answer to whatever card shows, as the main walk gives it: the first offer,
// "Tidak ada semua" or "Tidak tahu" on forms, no hour on the time card.
export async function answerCard(card: Locator, kind: string): Promise<void> {
  const buttons = card.locator('button[name="optionIds"]');
  switch (kind) {
    case "neighbourhood":
    case "textQuestion":
      return card.getByRole("button", { name: "Tidak tahu", exact: true }).click();
    case "numberForm":
      return card.getByRole("button", { name: "Tidak ada semua" }).click();
    case "chronologyReview":
      return card.getByRole("button", { name: "Tidak ada, lanjut" }).click();
    case "timeCard":
      await card.getByLabel("Hari ini").check();
      await card.getByLabel("Tidak tahu jamnya").check();
      return card.getByRole("button", { name: "Simpan jawaban" }).click();
    default: {
      // Offered a report nearby, the plain walk tells of its own event.
      if ((await card.getByRole("heading", { name: "Kejadian yang sama?" }).count()) > 0)
        return card.getByRole("button", { name: /^Bukan, kejadian lain/ }).click();
      const tiles = card.locator('input[name="optionIds"]');
      if ((await tiles.count()) === 0) return buttons.first().click();
      await tiles.first().check();
      return card.getByRole("button", { name: "Simpan jawaban" }).click();
    }
  }
}

// Right after "Kirim": the thank-you screen, a tap, a rating, then the ticket card.
export async function rateThenTicket(page: Page, rating = 4): Promise<void> {
  const thanks = page.getByRole("alertdialog");
  await expect(thanks.getByRole("heading", { name: /^Terima kasih, / })).toBeVisible();
  await thanks.getByRole("link").click();
  await expect(thanks.getByRole("heading", { name: "Bagaimana pengalaman melapor Anda?" })).toBeVisible();
  await thanks.getByRole("button", { name: `Nilai ${rating} dari 5` }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Terima kasih, laporan Anda sudah kami terima" })).toBeVisible();
}
