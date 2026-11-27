import { expect, test } from "@playwright/test";
import { closeOthers, noSidewaysScroll, ownAddress, syntheticNumber } from "./support.ts";

const DESK_CODE = "seeded-session-desk-officer-local-only";

test.beforeEach(async ({ context }) => ownAddress(context));
test.afterEach(async ({ browser, context }) => closeOthers(browser, context));

test("a missing person is reported from the home's door, the desk of the region moves it, and the reporter sees it", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  // A name has no digits, so each run's is letters of its own.
  const name = `Uji Hilang ${Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("")}`;
  const number = syntheticNumber();
  await page.goto("/");
  await page.getByRole("link", { name: /^Lapor orang hilang/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lapor orang hilang" })).toBeVisible();

  // Who reports comes first, then the page again.
  await page.getByRole("link", { name: "Isi data pelapor" }).click();
  await expect(page.getByRole("heading", { name: "Data pelapor" })).toBeVisible();
  await page.getByLabel("Warga").check();
  await page.getByLabel("Nama").fill("Uji Pelapor");
  await page.getByLabel("WhatsApp").fill(number);
  await page.getByRole("button", { name: "Setuju", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Periksa nomor Anda" })).toBeVisible();
  await page.getByRole("button", { name: "Ya", exact: true }).click();
  await expect(page).toHaveURL(/\/missing$/);

  await page.getByLabel("Cari desa atau kelurahan").fill("cot seumiyong");
  await page.getByRole("button", { name: "Cari desa" }).click();
  const form = page.getByRole("form", { name: "Lapor orang hilang" });
  await form
    .getByLabel(/^Cot Seumiyong, /)
    .first()
    .check();
  await form.getByLabel("Nama lengkap").fill(name);
  await form.getByLabel("Anak").check();
  await form.getByLabel("Pria").check();
  const yesterday = new Date(Date.now() - 86_400_000 + 7 * 3_600_000).toISOString().slice(0, 10);
  await form.getByLabel("Tanggal").fill(yesterday);
  await form.getByLabel("Nomor HP Anda").fill(number);
  await form.getByLabel("Tempat Anda menunggu kabar").fill("Posko Masjid Raya, Jalan Merdeka");
  await noSidewaysScroll(page);
  await form.getByRole("button", { name: "Kirim laporan orang hilang" }).click();
  await expect(page.getByRole("status").getByText("Laporan orang hilang terkirim")).toBeVisible();
  const mine = page.getByRole("listitem").filter({ hasText: name });
  await expect(mine.getByText("Dicari", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("sent.png"), fullPage: true });

  // The desk of Aceh Utara reads it, with the reporter's number, and moves it.
  const desk = await browser.newContext({ baseURL });
  await ownAddress(desk);
  const officer = await desk.newPage();
  await officer.goto("/desk", { waitUntil: "networkidle" });
  await officer.getByLabel("Kode masuk").fill(DESK_CODE);
  await expect(officer.getByLabel("Kode masuk")).toHaveValue(DESK_CODE);
  await officer.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(officer.getByRole("heading", { level: 1, name: "Peta laporan" })).toBeVisible();
  await officer.goto("/desk/missing");
  await expect(officer.getByRole("heading", { level: 1, name: "Orang dicari" })).toBeVisible();
  const card = officer
    .getByRole("listitem")
    .filter({ hasText: name })
    .filter({ has: officer.getByRole("button", { name: "Simpan status" }) });
  await expect(card.getByText("Pelapor menunggu di Posko Masjid Raya, Jalan Merdeka")).toBeVisible();
  await card.getByLabel("Status baru").selectOption({ label: "Ditemukan selamat" });
  await card.getByLabel("Catatan").fill("Bertemu keluarga di posko");
  await card.getByRole("button", { name: "Simpan status" }).click();
  await expect(officer.getByText("Status disimpan.")).toBeVisible();
  await noSidewaysScroll(officer);

  await page.goto("/missing");
  await expect(page.getByRole("listitem").filter({ hasText: name }).getByText("Ditemukan selamat")).toBeVisible();
});
