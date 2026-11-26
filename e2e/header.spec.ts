import { expect, test } from "@playwright/test";
import { noSidewaysScroll } from "./support.ts";

// The header is one row at every width: below 1024px the links sit in a menu, wider in the side rail.
test("the header stays one row, with its links in a menu below 1024px and in the side rail wider", async ({ page }) => {
  await page.goto("/lapor");
  const header = page.locator("header");
  const width = page.viewportSize()?.width ?? 0;
  expect((await header.boundingBox())?.height).toBeLessThanOrEqual(80);
  await noSidewaysScroll(page);
  const menu = header.locator("summary", { hasText: "Menu" });
  if (width >= 1024) {
    await expect(menu).toBeHidden();
    const rail = page.getByRole("navigation", { name: "Menu" });
    await expect(rail.getByRole("link", { name: "Beranda" })).toHaveAttribute("aria-current", "page");
    // It opens over the page, so the page does not move.
    const before = await page.locator("main").boundingBox();
    await rail.getByRole("link", { name: "Bantuan" }).hover();
    await expect.poll(async () => (await rail.boundingBox())?.width).toBeGreaterThan(200);
    expect(await page.locator("main").boundingBox()).toEqual(before);
    await rail.getByRole("link", { name: "Bantuan" }).click();
    await expect(page).toHaveURL(/\/lapor\/help$/);
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
