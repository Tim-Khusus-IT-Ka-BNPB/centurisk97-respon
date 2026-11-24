import { readFileSync } from "node:fs";
import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";
import { exifDateTime, withExif } from "../src/testing/jpegs.ts";
import { noSidewaysScroll, ownAddress, syntheticNumber } from "./support.ts";

const DESK_CODE = "seeded-session-desk-officer-local-only";
const PACE_MS = 3100;
// Inside the seed outline of Desa Cot Seumiyong, Aceh Utara (WIB).
const HERE = { lat: 5.14705, lon: 97.0482 };
const BASE = new Uint8Array(readFileSync("db/synthetic/photo-base.jpg"));

test.beforeEach(async ({ context }) => ownAddress(context));

type Card = { kind: string; cardId: string; groupId?: string; options?: { id: string }[] };
type Draft = { draftId: string; revision: number; card: Card };

// The reporter's side is walked through the API from its own browser context: this spec is
// about the desk, and the report flow has specs of its own.
async function sendReport(
  browser: Browser,
  baseURL: string,
  withPhoto = false,
): Promise<{ ticketNumber: string; token: string }> {
  const part = () => Math.floor(Math.random() * 250) + 1;
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "cf-connecting-ip": `10.${part()}.${part()}.${part()}`,
      origin: baseURL,
      "x-lapor-client": "1",
    },
  });
  const api: APIRequestContext = context.request;
  const call = async <T>(method: "GET" | "POST", path: string, data?: unknown): Promise<T> => {
    const response = await api.fetch(`/api/lapor${path}`, { method, ...(data === undefined ? {} : { data }) });
    expect(response.status(), `${method} ${path}`).toBeLessThan(300);
    return (await response.json()) as T;
  };
  const village = (await call<{ items: { code: string }[] }>("GET", "/places/regencies/11.08/villages?q=")).items[0]
    ?.code as string;
  let draft = await call<Draft>("POST", "/consent", {
    role: "citizen",
    name: "Uji Satu",
    number: syntheticNumber(),
    privacyVersion: 1,
    agree: true,
  });
  const answer = (card: Card): Record<string, unknown> => {
    switch (card.kind) {
      case "placeSearch":
        return { villageCode: village };
      case "choice":
      case "chronologyStep":
        return { optionIds: [card.options?.[0]?.id] };
      case "chronologyReview":
        return { optionIds: ["done"] };
      case "timeCard":
        return { optionIds: ["today", "hourUnknown"] };
      case "numberForm":
        return { optionIds: ["allNone"] };
      case "photos":
        return { optionIds: [photoSent ? "continue" : "cannotSend"] };
      default:
        return { optionIds: ["unknown"] };
    }
  };
  let photoSent = false;
  for (let step = 0; step < 60 && draft.card.kind !== "summary"; step++) {
    await new Promise((resolve) => setTimeout(resolve, PACE_MS));
    if (withPhoto && draft.card.kind === "photos" && !photoSent) {
      const photo = withExif(BASE, { make: "Uji", model: "Kamera", dateTime: exifDateTime(Date.now() - 10_000, 420) });
      const sent = await api.fetch(`/api/lapor/drafts/${draft.draftId}/photos`, {
        method: "POST",
        multipart: {
          photo: { name: "foto.jpg", mimeType: "image/jpeg", buffer: Buffer.from(photo) },
          revision: String(draft.revision),
          turnKey: crypto.randomUUID(),
          lat: String(HERE.lat),
          lon: String(HERE.lon),
          accuracy: "20",
          readAt: String(Date.now() - 30_000),
        },
      });
      expect(sent.status()).toBe(200);
      draft = (await sent.json()) as Draft;
      photoSent = true;
      continue;
    }
    draft = await call<Draft>("POST", `/drafts/${draft.draftId}/turns`, {
      revision: draft.revision,
      turnKey: crypto.randomUUID(),
      cardId: draft.card.cardId,
      kind: "answer",
      ...answer(draft.card),
    });
  }
  const sent = await call<{ ticketNumber: string }>("POST", `/drafts/${draft.draftId}/send`, {
    revision: draft.revision,
    turnKey: crypto.randomUUID(),
  });
  const card = (await call<{ card: { trackingToken: string } }>("GET", `/drafts/${draft.draftId}`)).card;
  await context.close();
  return { ticketNumber: sent.ticketNumber, token: card.trackingToken };
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/lapor/meja");
  await expect(page.getByRole("heading", { name: "Masuk meja laporan" })).toBeVisible();
  await page.getByLabel("Kode masuk").fill(DESK_CODE);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Meja laporan" })).toBeVisible();
}

test("a desk officer finds a new report, reads where each value came from, and opening it shows the reporter it was seen", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(240_000);
  const script = !info.project.name.includes("no-script");
  const { ticketNumber, token } = await sendReport(browser, baseURL as string);

  await signIn(page);
  await page.getByLabel("Nomor tiket").fill(ticketNumber);
  await page.getByRole("button", { name: "Terapkan" }).click();
  const row = page.getByRole("link", { name: new RegExp(ticketNumber) });
  await expect(row).toBeVisible();
  await expect(page.getByText("1 laporan")).toBeVisible();
  await expect(row.getByText("Diterima")).toBeVisible();
  await expect(row.getByText("Nomor belum diverifikasi")).toBeVisible();
  await expect(row.getByText("Uji Satu, Warga")).toBeVisible();
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath("queue.png"), fullPage: true });

  await row.click();
  await expect(page.getByRole("heading", { level: 2, name: ticketNumber })).toBeVisible();
  const status = page.getByText("Status tiket").locator("..");
  if (script) await expect(status.getByText("Dilihat")).toBeVisible();
  else {
    await expect(status.getByText("Diterima")).toBeVisible();
    await page.getByRole("button", { name: "Tandai sudah dilihat" }).click();
    await expect(status.getByText("Dilihat")).toBeVisible();
  }
  const values = page.getByRole("region", { name: /Isian laporan/ });
  await expect(values.getByText("Jenis bencana: Banjir")).toBeVisible();
  await expect(values.getByText("Dipilih pelapor").first()).toBeVisible();
  await expect(values.getByText(/^Meninggal:/)).toContainText("tidak ada");
  const reporter = page.getByRole("region", { name: "Pelapor" });
  await expect(reporter.getByRole("link", { name: /^Telepon \+62 800-/ })).toHaveAttribute("href", /^tel:\+62800\d+$/);
  await expect(
    page.getByRole("region", { name: "Riwayat tiket" }).getByText("Pusdalops BNPB, Petugas Uji"),
  ).toBeVisible();
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath("report.png"), fullPage: true });

  // The reporter's tracking page now shows the stage, without the officer's name.
  if (script) {
    const reporterPage = await (await browser.newContext()).newPage();
    await reporterPage.goto(`/lapor/lacak#t=${token}`);
    const seen = reporterPage.getByRole("listitem").filter({ hasText: "Sudah dilihat petugas" });
    await expect(seen).toContainText(/pukul \d{2}\.\d{2} WIB/);
    await expect(
      reporterPage.getByText("Petugas akan menghubungi pelapor bila perlu keterangan tambahan."),
    ).toBeVisible();
    await expect(reporterPage.getByText("Petugas Uji")).toHaveCount(0);
  }
});

test("the desk asks for a staff code, and a wrong code is named on its field", async ({ page }) => {
  await page.goto("/lapor/meja");
  await expect(page.getByRole("heading", { name: "Masuk meja laporan" })).toBeVisible();
  await expect(page.getByText("Daftar laporan")).toHaveCount(0);
  await page.getByLabel("Kode masuk").fill("bukan-kode");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page.getByText("Kode masuk tidak dikenal. Periksa kode dari admin, lalu masuk lagi.")).toBeVisible();
  await expect(page.getByLabel("Kode masuk")).toBeFocused();
  await noSidewaysScroll(page);
});

test("signing out ends the desk session", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Keluar" }).click();
  await expect(page.getByRole("heading", { name: "Masuk meja laporan" })).toBeVisible();
});

test("the map and the gallery show the filtered reports, and a page with no script lists every point", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(240_000);
  const script = !info.project.name.includes("no-script");
  const { ticketNumber } = await sendReport(browser, baseURL as string, true);
  await signIn(page);
  await page.getByLabel("Nomor tiket").fill(ticketNumber);
  await page.getByRole("button", { name: "Terapkan" }).click();
  await page.getByRole("navigation", { name: "Tampilan laporan" }).getByRole("link", { name: "Peta" }).click();
  await expect(page.getByRole("heading", { name: /Peta laporan/ })).toContainText("1 titik");
  if (script) {
    await expect(page.locator("button.desk-marker")).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByRole("region", { name: "Peta laporan", exact: true })).toHaveAttribute(
      "data-ready",
      "true",
      {
        timeout: 30_000,
      },
    );
  }
  await page.getByText("Daftar titik (1)").click();
  await expect(page.getByRole("link", { name: ticketNumber })).toBeVisible();
  await expect(page.getByText(/^5\.\d{6}, 97\.\d{6}, perkiraan tingkat desa$/)).toBeVisible();
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath("map.png"), fullPage: true });

  await page.getByRole("navigation", { name: "Tampilan laporan" }).getByRole("link", { name: "Galeri" }).click();
  await expect(page.getByRole("heading", { name: /Galeri foto/ })).toContainText("1 foto");
  const image = page.getByRole("img", { name: `Foto laporan ${ticketNumber}` });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText("Lokasi GPS perangkat")).toBeVisible();
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath("gallery.png"), fullPage: true });
});
