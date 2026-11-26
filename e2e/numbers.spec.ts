import { expect, test } from "@playwright/test";
import { noSidewaysScroll } from "./support.ts";

test("Nomor penting opens from the home's door and the header, each number a call", async ({ page }) => {
  await page.goto("/lapor");
  await page
    .getByRole("link", { name: /^Nomor penting/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/lapor\/nomor-penting$/);
  await expect(page.getByRole("heading", { level: 1, name: "Nomor penting" })).toBeVisible();
  for (const number of ["112", "115", "119"])
    await expect(page.locator(`a[href="tel:${number}"]`).first()).toBeVisible();
  await noSidewaysScroll(page);
  // Beside the theme switch from 640px, in the menu below it.
  await page.goto("/lapor/help");
  const header = page.locator("header");
  if ((page.viewportSize()?.width ?? 0) < 640) await header.locator("summary", { hasText: "Menu" }).click();
  await header.getByRole("link", { name: "Nomor penting" }).click();
  await expect(page).toHaveURL(/\/lapor\/nomor-penting$/);
});
