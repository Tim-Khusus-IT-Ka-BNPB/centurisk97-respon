import { expect, test } from "@playwright/test";
import { noSidewaysScroll, ownAddress } from "./support.ts";

test.beforeEach(async ({ context }) => ownAddress(context));

test("the home offers one way to report and BNPB's contacts", async ({ page }) => {
  const response = await page.goto("/lapor");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Laporkan kejadian bencana di sekitar Anda");
  await expect(page.getByRole("link", { name: "Lapor kejadian" })).toHaveAttribute("href", "/lapor/report");
  await expect(page.getByRole("heading", { name: "Kontak BNPB" })).toBeVisible();
  await noSidewaysScroll(page);
});

test("help, about and privacy open from the home with their content", async ({ page }) => {
  await page.goto("/lapor");
  // On a phone the header's links sit in its menu; on a wide screen in the side rail.
  const menu = page.getByRole("banner").locator("summary");
  const phone = await menu.isVisible();
  if (phone) await menu.click();
  const links = phone ? page.getByRole("banner") : page.getByRole("navigation", { name: "Menu" });
  await links.getByRole("link", { name: "Bantuan" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bantuan");
  for (const group of ["Melapor", "Istilah", "Status", "Privasi"])
    await expect(page.getByRole("heading", { level: 2, name: group })).toBeVisible();
  await noSidewaysScroll(page);
  await page.goto("/lapor/about");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tentang Pantau Bencana BNPB");
  await noSidewaysScroll(page);
  await page.goto("/lapor/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kebijakan privasi");
  await noSidewaysScroll(page);
});

test("a draft address nobody owns asks to sign in first and shows no message box", async ({ page }) => {
  const response = await page.goto("/lapor/report/0b4c5d6e-7f80-4912-a3b4-c5d6e7f80912");
  expect(response?.status()).toBe(401);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Masuk dulu dengan nomor WhatsApp Anda.");
  await expect(page.getByLabel("Pesan")).toHaveCount(0);
});

test("the api answers health", async ({ request }) => {
  const response = await request.get("/api/lapor/health");
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe("ok");
});

test("the site root leads to the service", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/lapor$/);
  await expect(page.getByRole("link", { name: "Lapor kejadian" })).toBeVisible();
});
