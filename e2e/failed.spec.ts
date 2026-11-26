import { expect, type Page, test } from "@playwright/test";
import { noSidewaysScroll, ownAddress } from "./support.ts";

test.beforeEach(async ({ context }, info) => {
  test.skip(info.project.name.includes("no-script"), "Without script every page is asked for whole");
  await ownAddress(context);
});

// On a phone the switch sits in the menu.
async function pressTheme(page: Page, name: string) {
  const menu = page.getByRole("banner").locator("details");
  if ((await menu.isVisible()) && (await menu.getAttribute("open")) === null) await menu.locator("summary").click();
  await page.getByRole("button", { name }).filter({ visible: true }).click();
}

const drawn = (page: Page, theme: "light" | "dark") =>
  expect(page.locator("html")).toHaveAttribute("data-theme", theme);
const heading = (page: Page) => page.getByRole("heading", { level: 1 });

test("a page cut off from the service says so, keeps the numbers to call and its theme, and comes back", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/lapor/help", { waitUntil: "networkidle" });
  // Once with a signal: what a switch needs is fetched then, and the page is refreshed after it.
  const refreshed = page.waitForResponse(
    (answer) => /\.data/.test(answer.url()) && answer.request().method() === "GET",
  );
  await pressTheme(page, "Pakai tema gelap");
  await (await refreshed).finished();
  await drawn(page, "dark");

  await context.setOffline(true);
  await pressTheme(page, "Pakai tema terang");
  await expect(heading(page)).toHaveText("Halaman belum bisa dibuka");
  await expect(page).toHaveTitle("Halaman belum bisa dibuka, Pantau Bencana BNPB");
  await drawn(page, "dark");
  // Nothing it needs is asked for now: it is drawn in full.
  await expect(page.getByRole("main")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  expect(await page.locator("header img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  for (const number of ["112", "117"])
    await expect(page.getByRole("link", { name: new RegExp(number) })).toHaveAttribute("href", `tel:${number}`);
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath("failed.png"), fullPage: true });

  // Still no signal: it stays, and says so.
  await page.getByRole("link", { name: "Muat ulang" }).click();
  await expect(page.getByText(/^Masih belum bisa dibuka/)).toBeVisible();

  await context.setOffline(false);
  await page.getByRole("link", { name: "Muat ulang" }).click();
  await expect(heading(page)).toHaveText("Bantuan");
  await drawn(page, "dark");
  expect(errors).toEqual([]);
});

test.describe("with no service worker", () => {
  // WebKit does not let a test cut off what passes through the service worker.
  test.use({ serviceWorkers: "block" });

  test("a refresh lost after what was done keeps the theme just picked", async ({ page }) => {
    await page.goto("/lapor/help", { waitUntil: "networkidle" });
    await page.route(/\.data/, (route) => (route.request().method() === "GET" ? route.abort() : route.continue()));
    await pressTheme(page, "Pakai tema gelap");
    await expect(heading(page)).toHaveText("Halaman belum bisa dibuka");
    await drawn(page, "dark");
    await page.unroute(/\.data/);
    await page.getByRole("link", { name: "Muat ulang" }).click();
    await expect(heading(page)).toHaveText("Bantuan");
    await drawn(page, "dark");
  });
});
