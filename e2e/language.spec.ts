import { expect, test } from "@playwright/test";
import { noSidewaysScroll, ownAddress } from "./support.ts";

test.beforeEach(async ({ context }) => ownAddress(context));

test("a language picked from the header is the whole public site's, the desk stays Indonesian", async ({
  page,
}, info) => {
  const script = !info.project.name.includes("no-script");
  await page.goto("/missing");
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await page.getByRole("link", { name: "Bahasa: Bahasa Indonesia. Ganti bahasa" }).click();
  // A dialog with a script, a page of its own without.
  if (script) await expect(page.getByRole("dialog", { name: "Pilih bahasa Anda" })).toBeVisible();
  else await expect(page).toHaveURL(/\/language\?back=/);
  await expect(page.getByRole("group", { name: "Sumatra" })).toBeVisible();
  await noSidewaysScroll(page);
  // The header's own chooser stays closed on the page of its own, so only the open one is picked.
  await page
    .locator("label")
    .filter({ has: page.getByRole("radio", { name: "English" }) })
    .click();
  await page.getByRole("button", { name: script ? "Lanjut dalam English" : "Pakai bahasa ini" }).click();

  await expect(page).toHaveURL(/\/missing$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "Report a missing person" })).toBeVisible();
  // Kept into the report, and on every other public page.
  await page.goto("/report");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/desk");
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await expect(page.getByRole("heading", { name: "Masuk meja laporan" })).toBeVisible();
});
