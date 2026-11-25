import { readFileSync } from "node:fs";
import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";
import { exifDateTime, withExif } from "../src/testing/jpegs.ts";
import { noSidewaysScroll, ownAddress, syntheticNumber } from "./support.ts";

const DESK_CODE = "seeded-session-desk-officer-local-only";
const REGENCY_CODE = "seeded-session-bpbd-regency-local-only";
const PROVINCE_CODE = "seeded-session-bpbd-province-local-only";
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

async function signIn(page: Page, code = DESK_CODE): Promise<void> {
  // Typing before the page has hydrated can lose the code on a slow machine, so wait for it to settle.
  await page.goto("/lapor/meja", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Masuk meja laporan" })).toBeVisible();
  await page.getByLabel("Kode masuk").fill(code);
  await expect(page.getByLabel("Kode masuk")).toHaveValue(code);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  // The desk opens on the map.
  await expect(page.getByRole("heading", { level: 1, name: "Peta laporan" })).toBeVisible();
}

// Search one ticket from the filter bar.
async function searchTicket(page: Page, ticketNumber: string): Promise<void> {
  await page.getByLabel("Nomor tiket").fill(ticketNumber);
  await page.getByRole("button", { name: "Cari", exact: true }).click();
  // The box already holds the number; the address holds it once the search is done.
  await expect(page).toHaveURL(new RegExp(`ticket=${ticketNumber}`));
}

// A view of the desk, from the side menu on a wide screen or the tabs on a phone.
const viewLink = (page: Page, name: "Daftar" | "Galeri") =>
  page.getByRole("link", { name: new RegExp(`^${name}( laporan| foto)?$`) });

test("a desk officer finds a new report, reads where each value came from, and opening it shows the reporter it was seen", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(240_000);
  const script = !info.project.name.includes("no-script");
  const { ticketNumber, token } = await sendReport(browser, baseURL as string);

  await signIn(page);
  await viewLink(page, "Daftar").click();
  await expect(page.getByRole("heading", { level: 1, name: "Daftar laporan" })).toBeVisible();
  await searchTicket(page, ticketNumber);
  // A table row on a wide screen, a card on a phone.
  const row = page.locator("tr:visible, li:visible").filter({ hasText: ticketNumber });
  await expect(row).toHaveCount(1);
  await expect(page.getByText("1 laporan", { exact: true })).toBeVisible();
  await expect(row.getByText("Diterima")).toBeVisible();
  await expect(row.getByText("Nomor belum diverifikasi")).toBeVisible();
  await expect(row.getByText("Uji Satu")).toBeVisible();
  await expect(row.getByText("Meninggal: tidak ada")).toBeAttached();
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath("queue.png"), fullPage: true });

  await row.getByRole("link").first().click();
  const heading = page.getByRole("heading", { level: 1, name: ticketNumber });
  await expect(heading).toBeVisible();
  const header = page.locator("header").filter({ has: heading });
  if (script) await expect(header.getByText("Dilihat", { exact: true })).toBeVisible();
  else {
    await expect(header.getByText("Diterima", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Tandai sudah dilihat" }).click();
    await expect(header.getByText("Dilihat", { exact: true })).toBeVisible();
  }
  const values = page.getByRole("region", { name: "Isian laporan" });
  await expect(
    values.locator("dt", { hasText: "Jenis bencana" }).locator("xpath=following-sibling::dd[1]"),
  ).toContainText("Banjir");
  await expect(values.getByText("Dipilih pelapor").first()).toBeVisible();
  await expect(
    values.locator("dt", { hasText: /^Meninggal$/ }).locator("xpath=following-sibling::dd[1]"),
  ).toContainText("tidak ada");
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
  await page.goto("/lapor/meja", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Masuk meja laporan" })).toBeVisible();
  await expect(page.getByText("Peta laporan")).toHaveCount(0);
  await page.getByLabel("Kode masuk").fill("bukan-kode");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page.getByText("Kode masuk tidak dikenal. Periksa kode dari admin, lalu masuk lagi.")).toBeVisible();
  await expect(page.getByLabel("Kode masuk")).toBeFocused();
  await noSidewaysScroll(page);
});

test("signing out ends the desk session", async ({ page }) => {
  await signIn(page);
  // On a phone the way out sits in the menu.
  const out = page.getByRole("button", { name: "Keluar" });
  if (!(await out.isVisible())) await page.getByText("Menu", { exact: true }).click();
  await out.click();
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
  await searchTicket(page, ticketNumber);
  const panel = page.getByRole("region", { name: "Laporan di peta" });
  await expect(panel.getByText("1 laporan", { exact: true })).toBeVisible();
  await expect(panel.getByRole("link", { name: /^Ada foto, 1 laporan$/ })).toBeVisible();
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
  await expect(panel.getByRole("link", { name: ticketNumber, exact: true })).toBeVisible();
  await expect(page.getByText(/^5\.\d{6}, 97\.\d{6}, perkiraan tingkat desa$/)).toBeVisible();
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath("map.png"), fullPage: true });

  await viewLink(page, "Galeri").click();
  await expect(page.getByRole("heading", { level: 1, name: "Galeri foto" })).toBeVisible();
  await expect(page.getByText("1 foto", { exact: true })).toBeVisible();
  const image = page.getByRole("img", { name: `Foto laporan ${ticketNumber}` });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText("Lokasi GPS perangkat")).toBeVisible();
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath("gallery.png"), fullPage: true });
});

test("an officer answers the reporter, moves the ticket to its end, and the tracking page follows", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(240_000);
  const script = !info.project.name.includes("no-script");
  const { ticketNumber, token } = await sendReport(browser, baseURL as string);
  await signIn(page);
  await page.goto(`/lapor/meja/${ticketNumber}`, { waitUntil: "networkidle" });
  const heading = page.getByRole("heading", { level: 1, name: ticketNumber });
  const header = page.locator("header").filter({ has: heading });
  if (!script) await page.getByRole("button", { name: "Tandai sudah dilihat" }).click();
  await expect(header.getByText("Dilihat", { exact: true })).toBeVisible();
  const actions = page.getByRole("region", { name: "Tindak lanjut" });

  // A reason too short is refused on its field, and what was typed stays.
  await actions.getByRole("radio", { name: "Tidak dapat ditindaklanjuti" }).check();
  await actions.locator("#note").fill("dup");
  await actions.getByRole("button", { name: "Simpan status" }).click();
  await expect(actions.getByText(/Alasan untuk pelapor terlalu pendek/)).toBeVisible();
  await expect(actions.locator("#note")).toBeFocused();
  await expect(actions.locator("#note")).toHaveValue("dup");
  await noSidewaysScroll(page);

  // A reply puts it under review.
  await actions.locator("summary", { hasText: "Balas pelapor" }).click();
  await actions.getByLabel("Balasan").fill("Terima kasih, kami cek");
  await actions.getByRole("button", { name: "Simpan balasan" }).click();
  await expect(page.getByRole("status")).toContainText("Balasan tersimpan. Status tiket: Sedang ditelaah.");
  await expect(actions.locator("summary", { hasText: "Balas pelapor (1)" })).toBeVisible();
  await expect(header.getByText("Ditelaah", { exact: true })).toBeVisible();

  // A check on site puts a figure right; the reporter's own stays.
  await actions.locator("summary", { hasText: "Pengecekan lapangan" }).click();
  await actions.getByRole("radio", { name: /^Sebagian benar/ }).check();
  await actions.getByLabel(/^Meninggal/).fill("2");
  await actions.getByLabel("Catatan pengecekan").fill("Dicek ke kepala desa");
  await actions.getByRole("button", { name: "Simpan pengecekan" }).click();
  await expect(page.getByRole("status")).toContainText("Pengecekan tersimpan.");
  await expect(page.getByRole("region", { name: "Riwayat tiket" }).getByText("Meninggal: 0 menjadi 2")).toBeVisible();

  for (const [label, note, short] of [
    ["Ditindaklanjuti", "Tim berangkat", "Ditindaklanjuti"],
    ["Selesai ditangani", "Air sudah surut", "Selesai"],
  ] as const) {
    await actions.getByRole("radio", { name: label, exact: true }).check();
    if (label === "Ditindaklanjuti") {
      // Starting the work names what is being done.
      await actions.getByRole("button", { name: "Simpan status" }).click();
      await expect(actions.getByText(/Pilih paling sedikit satu tindakan/)).toBeVisible();
      await actions.getByLabel("Evakuasi warga").check();
    } else {
      await actions.locator("#proof").setInputFiles({
        name: "foto.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from(
          withExif(BASE, { make: "Uji", model: "Kamera", dateTime: exifDateTime(Date.now() - 60_000, 420) }),
        ),
      });
      if (!script) await actions.getByRole("button", { name: "Kirim foto" }).click();
      await expect(page.getByRole("status")).toContainText("Foto penanganan tersimpan.");
      await expect(page.getByRole("img", { name: "Foto penanganan 1" })).toBeVisible();
      await actions.getByRole("radio", { name: label, exact: true }).check();
    }
    await actions.locator("#note").fill(note);
    await actions.getByRole("button", { name: "Simpan status" }).click();
    await expect(page.getByRole("status")).toContainText(`Status tersimpan. Tiket sekarang: ${label}.`);
    await expect(header.getByText(short, { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Riwayat tiket" }).getByText(note)).toBeVisible();
  }
  await expect(actions.getByRole("radio")).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("actions.png"), fullPage: true });

  // The reporter sees every stage done, and none of what staff wrote for themselves.
  if (script) {
    const reporterPage = await (await browser.newContext()).newPage();
    await reporterPage.goto(`/lapor/lacak#t=${token}`);
    const status = reporterPage.getByRole("region", { name: "Status laporan" });
    await expect(status.getByRole("listitem").filter({ hasText: /pukul \d{2}\.\d{2} WIB/ })).toHaveCount(5);
    await expect(status.getByText("Evakuasi warga")).toBeVisible();
    await expect(status.getByRole("img", { name: "Foto penanganan 1" })).toBeVisible();
    for (const text of ["Petugas Uji", "Tim berangkat", "kami cek"])
      await expect(reporterPage.getByText(text)).toHaveCount(0);
  }
});

test("a BPBD account works only its region, and asks for the reporter's identity each time", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(240_000);
  const { ticketNumber } = await sendReport(browser, baseURL as string);
  // The report is in this regency; the other account's province holds it not.
  await signIn(page, REGENCY_CODE);
  await searchTicket(page, ticketNumber);
  const panel = page.getByRole("region", { name: "Laporan di peta" });
  await expect(panel.getByText("1 laporan", { exact: true })).toBeVisible();
  await page.goto(`/lapor/meja/${ticketNumber}`, { waitUntil: "networkidle" });
  const reporter = page.getByRole("region", { name: "Pelapor", exact: true });
  await expect(reporter.getByText("Uji Satu")).toHaveCount(0);
  await expect(reporter.getByRole("link")).toHaveCount(0);
  await reporter.getByRole("button", { name: "Tampilkan identitas pelapor" }).click();
  await expect(reporter.getByText("Uji Satu")).toBeVisible();
  await expect(reporter.getByRole("link", { name: /^Telepon \+62 800-/ })).toBeVisible();
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath("regional.png"), fullPage: true });

  const other = await (await browser.newContext({ baseURL, javaScriptEnabled: true })).newPage();
  await ownAddress(other.context());
  await signIn(other, PROVINCE_CODE);
  await other.goto(`/lapor/meja/${ticketNumber}`);
  await expect(other.getByRole("heading", { name: "Meja laporan belum bisa dibuka" })).toBeVisible();
  await expect(other.getByText("Uji Satu")).toHaveCount(0);
});
