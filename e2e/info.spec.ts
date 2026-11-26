import { expect, test } from "@playwright/test";
import { noSidewaysScroll, ownAddress } from "./support.ts";

test.beforeEach(async ({ context }) => ownAddress(context));

// Info daerah is read on the server: a search, a regency's three days and the numbers, with or without script.
test("a resident finds their regency and reads its three days and the numbers to call", async ({ page }) => {
  await page.goto("/lapor/info");
  await page.getByRole("searchbox", { name: "Kabupaten, kota, kecamatan, atau desa" }).fill("Aceh Utara");
  await page.getByRole("button", { name: "Cari", exact: true }).click();
  await page
    .getByRole("link", { name: /^Aceh Utara, Aceh$|^Kab\. Aceh Utara, Aceh$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/lapor\/info\?kab=11\.08$/);
  await expect(page.getByRole("heading", { name: "Tiga hari ke depan di Kab. Aceh Utara" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: /^Kamis, 26 November$/ })).toBeVisible();
  await expect(page.getByText("Siapkan tas siaga dan pantau ketinggian air sungai")).toBeVisible();
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(3);
  await noSidewaysScroll(page);
  await page.getByRole("link", { name: "Ganti wilayah" }).click();
  await expect(page.getByRole("searchbox", { name: "Kabupaten, kota, kecamatan, atau desa" })).toBeVisible();
});
