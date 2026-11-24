import { expect, test } from "@playwright/test";
import {
  answerCard,
  liveCard,
  nextCard,
  noSidewaysScroll,
  ownAddress,
  paced,
  rateThenTicket,
  startReport,
  syntheticNumber,
} from "./support.ts";

test.beforeEach(async ({ context }) => ownAddress(context));

test("a new reporter walks from the form to a sent report with the model off", async ({ page }) => {
  test.setTimeout(240_000);
  await startReport(page, "Uji Satu", syntheticNumber());
  await expect(page.getByRole("link", { name: "Telepon 112" })).toHaveAttribute("href", "tel:112");
  await expect(page.getByRole("status")).toHaveCount(1);
  await noSidewaysScroll(page);

  let cardId = await liveCard(page).getAttribute("data-card-id");
  await page.getByLabel("Cari tempat").fill("sukamaju");
  await page.getByRole("button", { name: "Cari tempat" }).click();
  await expect(liveCard(page).getByText(/dari \d+ tempat cocok/)).toBeVisible();
  await noSidewaysScroll(page);
  await paced(() => liveCard(page).locator('button[name="villageCode"]').first().click());
  cardId = await nextCard(page, cardId);
  await expect(page.getByRole("log")).toBeVisible();

  for (let step = 0; step < 60; step++) {
    const card = liveCard(page);
    const kind = (await card.getAttribute("data-card-kind")) as string;
    await noSidewaysScroll(page);
    if (kind === "summary") break;
    await paced(() => answerCard(card, kind));
    cardId = await nextCard(page, cardId);
  }

  const summary = liveCard(page);
  await expect(summary).toHaveAttribute("data-card-kind", "summary");
  await expect(summary.getByText(/^Lengkap \d+ persen$/)).toBeVisible();
  await expect(summary.getByRole("link", { name: "Telepon 112" })).toHaveAttribute("href", "tel:112");
  await expect(summary.getByRole("button", { name: /^Ubah / }).first()).toBeVisible();
  await paced(() => summary.getByRole("button", { name: "Kirim", exact: true }).click());
  await nextCard(page, cardId);

  await expect(liveCard(page)).toHaveAttribute("data-card-kind", "sent");
  await rateThenTicket(page);
  await expect(page.getByTestId("ticket-number")).toHaveText(/^LA-\d{6}-\d{2,}$/);
  await expect(page.getByLabel("Pesan")).toHaveCount(0);
  await noSidewaysScroll(page);

  const stored = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    databases: indexedDB.databases ? (await indexedDB.databases()).length : 0,
  }));
  expect(stored).toEqual({ local: 0, session: 0, databases: 0 });
});
