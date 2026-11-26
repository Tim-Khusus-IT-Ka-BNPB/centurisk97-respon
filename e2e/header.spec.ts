import { expect, test } from "@playwright/test";
import { noSidewaysScroll } from "./support.ts";

// The header is one row at every width: on a phone the links sit in a menu, wider they show.
test("the header stays one row, with its links in a menu on a phone", async ({ page }) => {
  await page.goto("/lapor");
  const header = page.locator("header");
  const width = page.viewportSize()?.width ?? 0;
  expect((await header.boundingBox())?.height).toBeLessThanOrEqual(80);
  await noSidewaysScroll(page);
  const menu = header.locator("summary", { hasText: "Menu" });
  if (width >= 768) {
    await expect(menu).toBeHidden();
    await expect(header.getByRole("link", { name: "Bantuan" })).toBeVisible();
    return;
  }
  await expect(header.getByRole("link", { name: "Bantuan" })).toBeHidden();
  await menu.click();
  await expect(header.getByRole("link", { name: "Tentang" })).toBeVisible();
  // The theme switch rides in the menu on a phone.
  await expect(header.getByRole("button", { name: "Pakai tema gelap" })).toBeVisible();
  await header.getByRole("link", { name: "Bantuan" }).click();
  await expect(page).toHaveURL(/\/lapor\/help$/);
  await expect(page.locator("header details")).not.toHaveAttribute("open");
});
