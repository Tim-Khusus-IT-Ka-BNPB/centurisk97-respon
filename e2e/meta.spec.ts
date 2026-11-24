import { expect, test } from "@playwright/test";
import { ownAddress } from "./support.ts";

test.beforeEach(async ({ context }) => ownAddress(context));

// Read from the served HTML, before any script runs, as a search engine or a share preview does.
async function tagsOf(html: string) {
  const content = (attribute: string, key: string) =>
    html.match(new RegExp(`<meta ${attribute}="${key}" content="([^"]*)"`))?.[1];
  return {
    title: html.match(/<title>([^<]*)<\/title>/)?.[1],
    description: content("name", "description"),
    robots: content("name", "robots"),
    canonical: html.match(/<link rel="canonical" href="([^"]*)"/)?.[1],
    og: (key: string) => content("property", `og:${key}`),
    twitter: (key: string) => content("name", `twitter:${key}`),
    count: (pattern: RegExp) => html.match(pattern)?.length ?? 0,
  };
}

const PUBLIC = ["/lapor", "/lapor/report", "/lapor/help", "/lapor/about", "/lapor/privacy"];

test("every public page has its own title, description, canonical address and share card", async ({ request }) => {
  const titles = new Set<string>();
  for (const path of PUBLIC) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const tags = await tagsOf(await response.text());
    expect(tags.title, path).toBeTruthy();
    titles.add(tags.title as string);
    expect(tags.description?.length ?? 0, path).toBeGreaterThanOrEqual(110);
    expect(tags.description?.length ?? 0, path).toBeLessThanOrEqual(160);
    expect(tags.robots).toBe("index, follow");
    expect(tags.canonical).toBe(new URL(path, response.url()).href);
    expect(tags.og("url")).toBe(tags.canonical);
    expect(tags.og("title")).toBe(tags.title);
    expect(tags.og("description")).toBe(tags.description);
    expect(tags.og("type")).toBe("website");
    expect(tags.og("locale")).toBe("id_ID");
    expect(tags.og("site_name")).toBe("Pantau Bencana BNPB");
    expect(tags.twitter("card")).toBe("summary_large_image");
    expect(tags.count(/<title>/g)).toBe(1);
    expect(tags.count(/rel="canonical"/g)).toBe(1);
    const image = await request.get(tags.og("image") as string);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/png");
  }
  expect(titles.size).toBe(PUBLIC.length);
});

test("icons answer and the browser bar follows the colour scheme", async ({ request }) => {
  const html = await (await request.get("/lapor")).text();
  for (const href of ["/favicon-32.png", "/apple-touch-icon.png", "/lambang-bnpb.png"]) {
    expect(html).toMatch(new RegExp(`(href|src)="${href}"`));
    expect((await request.get(href)).status()).toBe(200);
  }
  expect(html).toContain('name="theme-color" content="#e9eff7" media="(prefers-color-scheme: light)"');
  expect(html).toContain('name="theme-color" content="#142235" media="(prefers-color-scheme: dark)"');
});

test("a draft page is not indexed and its share card names nothing of the draft", async ({ request }) => {
  const address = "/lapor/report/0b4c5d6e-7f80-4912-a3b4-c5d6e7f80912";
  const html = await (await request.get(address)).text();
  const tags = await tagsOf(html);
  expect(tags.robots).toBe("noindex, nofollow");
  expect(tags.canonical?.endsWith("/lapor/report")).toBe(true);
  expect(tags.og("url")).toBe(tags.canonical);
  expect(html.match(/<head>[\s\S]*<\/head>/)?.[0]).not.toContain("0b4c5d6e");
});

test("an unknown address answers 404, is not indexed and leads home", async ({ page }) => {
  const response = await page.goto("/lapor/nowhere");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Halaman tidak ditemukan");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.getByRole("link", { name: "Ke halaman awal" })).toHaveAttribute("href", "/lapor");
});
