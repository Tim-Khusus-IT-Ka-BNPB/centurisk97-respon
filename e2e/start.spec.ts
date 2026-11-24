import { expect, test } from "@playwright/test";
import { noSidewaysScroll, ownAddress, syntheticNumber } from "./support.ts";

test.beforeEach(async ({ context }) => ownAddress(context));

test("a missing position for an officer is named under the field, tied to it, with focus on it", async ({ page }) => {
  await page.goto("/lapor/report");
  await page.getByLabel("Petugas BPBD").check();
  await page.getByLabel("Nama").fill("Uji Satu");
  await page.getByLabel("WhatsApp").fill(syntheticNumber());
  await page.getByLabel("BPBD", { exact: true }).fill("Kabupaten Contoh");
  await page.getByText("Baca kebijakan privasi lengkap").click();
  await page.getByRole("button", { name: "Setuju", exact: true }).click();
  const position = page.getByLabel("Jabatan");
  await expect(position).toBeFocused();
  await expect(position).toHaveAttribute("aria-invalid", "true");
  await expect(position).toHaveAttribute("aria-describedby", /officerPosition-error/);
  await expect(page.locator("#officerPosition-error")).toHaveText(
    "Jabatan belum diisi. Isi Jabatan untuk melanjutkan.",
  );
  await expect(page.getByLabel("BPBD", { exact: true })).toHaveValue("Kabupaten Contoh");
  await expect(page.getByLabel("Nama")).toHaveValue("Uji Satu");
  await noSidewaysScroll(page);
});

test("the number is read back as stored, and Ganti returns to the form with every value", async ({ page }) => {
  await page.goto("/lapor/report");
  await page.getByLabel("Warga").check();
  await page.getByLabel("Nama").fill("Uji Satu");
  await page.getByLabel("WhatsApp").fill("6280000000001");
  await page.getByRole("button", { name: "Setuju", exact: true }).click();
  await expect(page.getByText("Nomor ini yang akan dicatat: +62 800 0000 0001. Benar?")).toBeVisible();
  await page.getByRole("button", { name: "Ganti" }).click();
  await expect(page.getByLabel("WhatsApp")).toHaveValue("6280000000001");
  await expect(page.getByLabel("WhatsApp")).toBeFocused();
  await expect(page.getByLabel("Warga")).toBeChecked();
});

test("a decline asks first, its way back keeps the values, and the decline itself shows 112", async ({ page }) => {
  await page.goto("/lapor/report");
  await page.getByLabel("Warga").check();
  await page.getByLabel("Nama").fill("Uji Dua");
  await page.getByRole("button", { name: "Tidak setuju" }).click();
  await expect(page.getByRole("heading", { name: "Tidak setuju?" })).toBeVisible();
  await page.getByRole("button", { name: "Buka formulir lagi" }).click();
  await expect(page.getByLabel("Nama")).toHaveValue("Uji Dua");
  await page.getByRole("button", { name: "Tidak setuju" }).click();
  await page.getByRole("button", { name: "Ya, tidak setuju" }).click();
  await expect(page.getByRole("heading", { name: "Laporan tidak dibuat" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Telepon 112" })).toHaveAttribute("href", "tel:112");
  expect(page.url()).not.toContain("#");
});
