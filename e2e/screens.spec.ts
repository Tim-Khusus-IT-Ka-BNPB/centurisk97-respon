import { expect, type Page, test } from "@playwright/test";
import {
  answerCard,
  liveCard,
  nextCard,
  noSidewaysScroll,
  ownAddress,
  paced,
  startReport,
  syntheticNumber,
} from "./support.ts";

// Pictures of every screen for the builder and the designer to read. Runs only when asked
// (SCREENS_DIR set) and writes outside the repository.
const dir = process.env.SCREENS_DIR;
test.skip(!dir, "screens are taken only on request");
test.beforeEach(async ({ context }) => ownAddress(context));

const SIZES = [
  { name: "320", width: 320, height: 640 },
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1920", width: 1920, height: 1080 },
  { name: "320short", width: 320, height: 440 },
] as const;

async function shoot(page: Page, label: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const)
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), scheme);
      await noSidewaysScroll(page);
      await page.screenshot({ path: `${dir}/${label}-${size.name}-${scheme}.png`, fullPage: true });
    }
  // Text at 200%: the root size doubled, as a phone's text size setting does for rem sizes.
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.style.setProperty("font-size", "200%");
  });
  await page.screenshot({ path: `${dir}/${label}-320font200-light.png`, fullPage: true });
  await page.evaluate(() => document.documentElement.style.removeProperty("font-size"));
  await page.setViewportSize({ width: 390, height: 844 });
}

test("public pages", async ({ page }) => {
  for (const path of ["/", "/help", "/about", "/privacy", "/nowhere"]) {
    await page.goto(path);
    await shoot(page, `page${path === "/" ? "-home" : path.replace("/", "-")}`);
  }
});

test("the start step and its views", async ({ page }) => {
  await page.goto("/report");
  await shoot(page, "start-form");
  await page.getByLabel("Petugas BPBD").check();
  await page.getByLabel("Nama").fill("Uji Satu");
  await page.getByLabel("WhatsApp").fill(syntheticNumber());
  await page.getByLabel("BPBD", { exact: true }).fill("Kabupaten Contoh");
  await page.getByText("Baca kebijakan privasi lengkap").click();
  await page.getByRole("button", { name: "Setuju", exact: true }).click();
  await expect(page.getByLabel("Jabatan")).toBeFocused();
  await shoot(page, "start-form-error");
  await page.getByLabel("Jabatan").fill("Staf");
  await page.getByRole("button", { name: "Setuju", exact: true }).click();
  await shoot(page, "start-readback");
  await page.getByRole("button", { name: "Ganti", exact: true }).click();
  await page.getByRole("button", { name: "Tidak setuju" }).click();
  await shoot(page, "start-decline-confirm");
  await page.getByRole("button", { name: "Ya, tidak setuju" }).click();
  await shoot(page, "start-declined");
});

test("every card of a walk", async ({ page }) => {
  test.setTimeout(300_000);
  await startReport(page, "Uji Satu", syntheticNumber());
  await shoot(page, "card-place-empty");
  await page.getByLabel("Pesan", { exact: true }).fill("kembali");
  await page.getByRole("button", { name: "Kirim pesan" }).click();
  await expect(page.getByText("Belum ada jawaban yang bisa dibatalkan.")).toBeVisible();
  await shoot(page, "card-nothing-to-undo");
  let cardId = await liveCard(page).getAttribute("data-card-id");
  await page.getByLabel("Cari tempat").fill("zzqx");
  await page.getByRole("button", { name: "Cari tempat" }).click();
  await shoot(page, "card-place-nomatch");
  await page.getByLabel("Cari tempat").fill("sukamaju");
  await page.getByRole("button", { name: "Cari tempat" }).click();
  await expect(liveCard(page).getByText(/tempat cocok/)).toBeVisible();
  await shoot(page, "card-place-results");
  await liveCard(page).getByRole("link").first().click();
  await expect(liveCard(page)).toHaveAttribute("data-card-kind", "regencyVillages");
  await shoot(page, "card-area-villages");
  await paced(() => liveCard(page).locator('button[name="villageCode"]').first().click());
  cardId = await nextCard(page, cardId);
  const seen = new Set<string>();
  for (let step = 0; step < 60; step++) {
    const card = liveCard(page);
    const kind = (await card.getAttribute("data-card-kind")) as string;
    const label = `card-${String(step).padStart(2, "0")}-${kind}`;
    if (!seen.has(kind) || kind === "choice") await shoot(page, label);
    seen.add(kind);
    if (kind === "summary") break;
    await paced(() => answerCard(card, kind));
    cardId = await nextCard(page, cardId);
  }
  await liveCard(page).getByRole("button", { name: "Batal" }).click();
  await shoot(page, "card-cancel-confirm");
  await liveCard(page).getByRole("button", { name: "Lanjutkan mengisi" }).click();
  await paced(() => liveCard(page).getByRole("button", { name: "Kirim", exact: true }).click());
  await expect(liveCard(page)).toHaveAttribute("data-card-kind", /sent|summary/);
  await shoot(page, "card-after-send");
  await page.goto("/report");
  await shoot(page, "start-known");
});
