import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { exifDateTime, withExif } from "../src/testing/jpegs.ts";
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

// Inside the seed outline of Desa Cot Seumiyong, Kec. Kuta Makmur, Aceh Utara (WIB).
const HERE = { latitude: 5.14705, longitude: 97.0482, accuracy: 12 };
const BASE = new Uint8Array(readFileSync("db/synthetic/photo-base.jpg"));

// A photo a phone camera wrote just now, on a WIB clock, at the given place.
const cameraPhoto = (name: string) => ({
  name,
  mimeType: "image/jpeg",
  buffer: Buffer.from(
    withExif(BASE, {
      make: "Uji",
      model: "Kamera",
      dateTime: exifDateTime(Date.now() - 10_000, 420),
      offset: "+07:00",
      point: { lat: HERE.latitude, lon: HERE.longitude },
    }),
  ),
});

test.beforeEach(async ({ context }) => {
  await ownAddress(context);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(HERE);
});

async function placeByGps(page: Page): Promise<string | null> {
  let cardId = await liveCard(page).getAttribute("data-card-id");
  await paced(() => page.getByRole("button", { name: "Pakai lokasi saat ini" }).click());
  cardId = await nextCard(page, cardId);
  return cardId;
}

test("GPS reads the village with its coordinates and accuracy, and Bukan lists 5 nearby", async ({ page }, info) => {
  test.skip(info.project.name.includes("no-script"), "Reading the position needs script");
  test.setTimeout(120_000);
  await startReport(page, "Uji Satu", syntheticNumber());
  let cardId = await placeByGps(page);
  const read = liveCard(page);
  await expect(read).toHaveAttribute("data-card-kind", "placeConfirm");
  await expect(read.getByRole("heading", { name: "Lokasi terbaca" })).toBeVisible();
  await expect(read.getByText("Desa/Kel. Cot Seumiyong")).toBeVisible();
  await expect(read.getByText("Kec. Kuta Makmur, Aceh Utara, Aceh")).toBeVisible();
  await expect(read.getByText("Titik 5.147050, 97.048200")).toBeVisible();
  await expect(read.getByText("Titik GPS, ketelitian ±12 m")).toBeVisible();
  await noSidewaysScroll(page);
  await liveCard(page).screenshot({ path: test.info().outputPath("place-confirm.png") });

  await paced(() => read.getByRole("button", { name: "Bukan, pilih desa/kelurahan lain" }).click());
  cardId = await nextCard(page, cardId);
  const list = liveCard(page);
  await expect(list.getByRole("heading", { name: "Pilih desa/kelurahan lokasi kejadian" })).toBeVisible();
  const rows = list.locator('button[name="villageCode"]');
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText(/km dari titik Anda/);
  await noSidewaysScroll(page);
  await liveCard(page).screenshot({ path: test.info().outputPath("place-nearby.png") });
  const second = (await rows.nth(1).locator("span.font-semibold").textContent()) as string;
  await paced(() => rows.nth(1).click());
  await nextCard(page, cardId);
  await expect(liveCard(page)).toHaveAttribute("data-card-kind", "neighbourhood");
  await expect(page.getByRole("log").getByText(second.replace("Desa/Kel. ", ""))).toBeVisible();
});

test("photos taken at the scene show their badges and time, and the summary counts them", async ({ page }, info) => {
  test.setTimeout(240_000);
  const script = !info.project.name.includes("no-script");
  await startReport(page, "Uji Satu", syntheticNumber());
  let cardId: string | null;
  if (script) cardId = await placeByGps(page);
  else {
    cardId = await liveCard(page).getAttribute("data-card-id");
    await page.getByLabel("Cari tempat").fill("cot seumiyong");
    await page.getByRole("button", { name: "Cari tempat" }).click();
    const village = liveCard(page).locator('button[name="villageCode"]').first();
    // With no village to pick, say what the card shows instead, so a failure names its cause.
    await village.waitFor({ timeout: 30_000 }).catch(async (error: unknown) => {
      const said = (await liveCard(page).innerText()).replace(/\s+/g, " ").slice(0, 300);
      throw new Error(`No village to pick at ${page.url()}; the card says: ${said}`, { cause: error });
    });
    await paced(() => village.click());
    cardId = await nextCard(page, cardId);
  }
  for (let step = 0; step < 60; step++) {
    const card = liveCard(page);
    const kind = (await card.getAttribute("data-card-kind")) as string;
    if (kind === "photos") break;
    await paced(() =>
      kind === "placeConfirm" ? card.getByRole("button", { name: "Benar" }).click() : answerCard(card, kind),
    );
    cardId = await nextCard(page, cardId);
  }
  const card = liveCard(page);
  await expect(card).toHaveAttribute("data-card-kind", "photos");
  await expect(card.getByText("0 dari 10 foto")).toBeVisible();
  await expect(card.getByRole("button", { name: "Tidak bisa mengirim foto" })).toBeVisible();

  for (let n = 1; n <= 3; n++) {
    await paced(async () => {
      await liveCard(page)
        .locator('input[name="photo"]')
        .setInputFiles(cameraPhoto(`foto-${n}.jpg`));
      if (!script) await liveCard(page).getByRole("button", { name: "Kirim foto" }).click();
    });
    cardId = await nextCard(page, cardId);
    await expect(liveCard(page).getByText(`${n} dari 10 foto`)).toBeVisible();
  }
  const photos = liveCard(page);
  await expect(photos.getByRole("img")).toHaveCount(3);
  for (const image of await photos.getByRole("img").all())
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // With script the phone's own fix is sent; with none, the place written in the photo is used.
  const badge = script ? "Lokasi GPS perangkat" : "Lokasi dari data foto";
  await expect(photos.getByText(badge)).toHaveCount(3);
  await expect(photos.getByText(/WIB, waktu EXIF foto/)).toHaveCount(3);
  await noSidewaysScroll(page);
  await liveCard(page).screenshot({ path: test.info().outputPath("photos.png") });

  // One sent by mistake is taken back.
  await paced(() => photos.getByRole("button", { name: "Hapus foto 2" }).click());
  cardId = await nextCard(page, cardId);
  await expect(liveCard(page).getByText("2 dari 10 foto")).toBeVisible();
  await expect(liveCard(page).getByRole("img")).toHaveCount(2);

  await paced(() => liveCard(page).getByRole("button", { name: "Lanjut" }).click());
  await nextCard(page, cardId);
  const summary = liveCard(page);
  await expect(summary).toHaveAttribute("data-card-kind", "summary");
  await expect(summary.getByText("2 foto, 2 dengan lokasi terekam")).toBeVisible();
  await summary.getByText("2 foto, 2 dengan lokasi terekam").scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("summary-photos.png") });
});

test("a screenshot is refused with its reason and nothing is kept", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium", "One phone is enough for a refusal");
  test.setTimeout(180_000);
  await startReport(page, "Uji Satu", syntheticNumber());
  let cardId = await placeByGps(page);
  for (let step = 0; step < 60; step++) {
    const card = liveCard(page);
    const kind = (await card.getAttribute("data-card-kind")) as string;
    if (kind === "photos") break;
    await paced(() =>
      kind === "placeConfirm" ? card.getByRole("button", { name: "Benar" }).click() : answerCard(card, kind),
    );
    cardId = await nextCard(page, cardId);
  }
  const screenshot = {
    name: "layar.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(withExif(BASE, { dateTime: exifDateTime(Date.now(), 420) })),
  };
  await paced(() => liveCard(page).locator('input[name="photo"]').setInputFiles(screenshot));
  await expect(liveCard(page).getByText(/Tangkapan layar dan gambar hasil sunting tidak diterima/)).toBeVisible();
  await expect(liveCard(page).getByText("0 dari 10 foto")).toBeVisible();
});
