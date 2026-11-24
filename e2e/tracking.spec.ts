import { expect, test } from "@playwright/test";
import {
  answerCard,
  liveCard,
  nextCard,
  noSidewaysScroll,
  ownAddress,
  paced,
  startReport,
  syntheticNumber,
} from "./support.ts";

test.beforeEach(async ({ context }) => ownAddress(context));

test("a sent report thanks, asks a rating, shows its ticket, and its link opens anywhere without a name", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const script = !info.project.name.includes("no-script");
  const number = syntheticNumber();
  await startReport(page, "Uji Satu", number);
  let cardId = await liveCard(page).getAttribute("data-card-id");
  await page.getByLabel("Cari tempat").fill("sukamaju");
  await page.getByRole("button", { name: "Cari tempat" }).click();
  await paced(() => liveCard(page).locator('button[name="villageCode"]').first().click());
  cardId = await nextCard(page, cardId);
  for (let step = 0; step < 60; step++) {
    const card = liveCard(page);
    const kind = (await card.getAttribute("data-card-kind")) as string;
    if (kind === "summary") break;
    await paced(() => answerCard(card, kind));
    cardId = await nextCard(page, cardId);
  }
  await paced(() => liveCard(page).getByRole("button", { name: "Kirim", exact: true }).click());

  // The thank-you screen, then the rating.
  const thanks = page.getByRole("alertdialog");
  await expect(thanks.getByRole("heading", { name: "Terima kasih, Uji!" })).toBeVisible();
  await expect(thanks.getByText(/^LA-\d{6}-\d{2,}$/)).toBeVisible();
  await noSidewaysScroll(page);
  await page.screenshot({ path: test.info().outputPath("thanks.png") });
  await thanks.getByRole("link").click();
  await expect(thanks.getByRole("heading", { name: "Bagaimana pengalaman melapor Anda?" })).toBeVisible();
  for (let n = 1; n <= 5; n++) await expect(thanks.getByRole("button", { name: `Nilai ${n} dari 5` })).toBeInViewport();
  await noSidewaysScroll(page);
  await page.screenshot({ path: test.info().outputPath("rating.png") });
  await thanks.getByRole("button", { name: "Nilai 4 dari 5" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // The ticket card.
  const ticket = liveCard(page);
  await expect(ticket.getByRole("heading", { name: "Terima kasih, laporan Anda sudah kami terima" })).toBeVisible();
  const ticketNumber = (await ticket.getByTestId("ticket-number").textContent()) as string;
  await expect(ticket.getByRole("img", { name: `Kode QR lacak laporan ${ticketNumber}` })).toBeVisible();
  await expect(ticket.getByText("Hubungi BPBD setempat")).toBeVisible();
  await expect(ticket.getByRole("link", { name: /^Telepon / })).toHaveAttribute("href", /^tel:\d+$/);
  await expect(ticket.getByText(/PDF|Word|menghubungi Anda|diteruskan/i)).toHaveCount(0);
  await noSidewaysScroll(page);
  await ticket.screenshot({ path: test.info().outputPath("ticket.png") });
  const link = (await ticket.getByRole("link", { name: "Lacak laporan" }).getAttribute("href")) as string;
  expect(link).toMatch(/^\/lapor\/lacak#t=[0-9a-f]{32}$/);

  // Laporan saya on the home lists it.
  await page.goto("/lapor");
  const mine = page.getByRole("region", { name: "Laporan saya" });
  await expect(mine.getByText(ticketNumber)).toBeVisible();

  // The link in a fresh browser: no cookie, no sign-in, no name or number, no token in any address.
  const fresh = await browser.newContext({ javaScriptEnabled: script, viewport: page.viewportSize() ?? undefined });
  await ownAddress(fresh);
  const tab = await fresh.newPage();
  const addresses: string[] = [];
  tab.on("request", (request) => addresses.push(request.url()));
  await tab.goto(link);
  if (!script) {
    await expect(tab.getByText(/Halaman lacak perlu JavaScript/)).toBeVisible();
    await fresh.close();
    return;
  }
  await expect(tab.getByRole("heading", { level: 1, name: ticketNumber })).toBeVisible();
  await expect(tab.getByText("Laporan diterima")).toBeVisible();
  await expect(tab.getByText("Menunggu")).toHaveCount(4);
  const text = (await tab.locator("body").textContent()) as string;
  expect(text).not.toContain("Uji");
  expect(text).not.toContain(number.slice(0, 7));
  const token = link.split("=")[1] as string;
  expect(addresses.filter((address) => address.includes(token))).toEqual([]);
  await noSidewaysScroll(tab);
  await tab.screenshot({ path: test.info().outputPath("tracking.png"), fullPage: true });

  // One character changed: not found.
  const changed = `${link.slice(0, -1)}${link.endsWith("0") ? "1" : "0"}`;
  const answer = tab.waitForResponse((response) => response.url().endsWith("/api/lapor/tracking"));
  await tab.goto("/lapor");
  await tab.goto(changed);
  expect((await answer).status()).toBe(404);
  await expect(tab.getByRole("heading", { level: 1, name: "Laporan tidak ditemukan." })).toBeVisible();
  await fresh.close();
});
