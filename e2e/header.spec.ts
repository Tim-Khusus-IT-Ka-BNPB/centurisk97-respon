import { expect, test } from "@playwright/test";
import { noSidewaysScroll } from "./support.ts";

// The header is one row at every width: below 1024px the main places sit in the tab bar and the rest
// in a menu, wider in the side rail.
test("the header stays one row, with the tab bar and a menu below 1024px and the side rail wider", async ({ page }) => {
  await page.goto("/");
  const header = page.locator("header");
  const width = page.viewportSize()?.width ?? 0;
  expect((await header.boundingBox())?.height).toBeLessThanOrEqual(80);
  await noSidewaysScroll(page);
  const menu = header.locator("summary", { hasText: "Menu" });
  const bar = page.getByRole("navigation", { name: "Menu utama" });
  if (width >= 1024) {
    await expect(menu).toBeHidden();
    await expect(bar).toBeHidden();
    const rail = page.getByRole("navigation", { name: "Menu" });
    await expect(rail.getByRole("link", { name: "Beranda" })).toHaveAttribute("aria-current", "page");
    // It opens over the page, so the page does not move.
    const before = await page.locator("main").boundingBox();
    await rail.getByRole("link", { name: "Bantuan" }).hover();
    await expect.poll(async () => (await rail.boundingBox())?.width).toBeGreaterThan(200);
    expect(await page.locator("main").boundingBox()).toEqual(before);
    await rail.getByRole("link", { name: "Bantuan" }).click();
    await expect(page).toHaveURL(/\/help$/);
    return;
  }
  // Each tab is a thumb's target, and the footer is not hidden under the bar.
  await expect(bar.getByRole("link", { name: "Beranda" })).toHaveAttribute("aria-current", "page");
  for (const tab of await bar.getByRole("link").all()) {
    const box = await tab.boundingBox();
    expect(Math.min(box?.width ?? 0, box?.height ?? 0)).toBeGreaterThanOrEqual(48);
  }
  await page.locator("footer").scrollIntoViewIfNeeded();
  const footer = await page.locator("footer").boundingBox();
  const top = (await bar.boundingBox())?.y ?? 0;
  expect((footer?.y ?? 0) + (footer?.height ?? 0)).toBeLessThanOrEqual(top + 1);
  await menu.click();
  await expect(header.getByRole("link", { name: "Tentang" })).toBeVisible();
  // The theme switch rides in the menu on a phone.
  await expect(header.getByRole("button", { name: "Pakai tema gelap" })).toBeVisible();
  await bar.getByRole("link", { name: "Bantuan" }).click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(bar.getByRole("link", { name: "Bantuan" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("header details")).not.toHaveAttribute("open");
});

test("the tab bar steps aside while a field is typed in, so the keyboard cannot lift it over the field", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 1024, "the side rail holds the places on a wide screen");
  await page.goto("/info");
  const bar = page.getByRole("navigation", { name: "Menu utama" });
  await expect(bar).toBeVisible();
  await page.getByRole("searchbox").first().focus();
  await expect(bar).toBeHidden();
  await page.getByRole("searchbox").first().blur();
  await expect(bar).toBeVisible();
});
