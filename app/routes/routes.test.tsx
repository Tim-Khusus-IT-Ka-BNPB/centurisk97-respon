import { cleanup, screen } from "@testing-library/react";
import { createElement, type FC } from "react";
import { describe, expect, test, vi } from "vitest";
import type { ApiCall } from "../../src/api/bridge";
import { SAMPLE_DRAFTS, SAMPLE_FIELD_ERROR, SAMPLE_ME } from "../../src/testing/samples";
import { LOST } from "../lib/network";
import * as root from "../root";
import { never, renderPage } from "../testing/render";
import AboutRoute, * as about from "./about";
import DraftRoute, * as draft from "./draft";
import HelpRoute, * as help from "./help";
import HomeRoute, * as home from "./home";
import NotFoundRoute, * as notFound from "./notFound";
import PrivacyRoute, * as privacy from "./privacy";
import StartRoute, * as start from "./start";
import TrackingRoute, * as tracking from "./tracking";

const DRAFT = SAMPLE_DRAFTS.summary.draftId;
const api =
  (answers: Record<string, () => Response>): ApiCall =>
  async (method, path) => {
    const answer = answers[`${method} ${path.split("?")[0]}`];
    if (!answer) throw new Error(`no answer for ${method} ${path}`);
    return answer();
  };
const json =
  (body: unknown, status = 200) =>
  () =>
    Response.json(body, { status });
// Route arguments are built by the framework; each test passes only what the function reads.
type Args = never;
const routeElement = (Component: unknown, props: object) => createElement(Component as FC<object>, props);
const post = (url: string, entries: [string, string][]) => {
  const body = new FormData();
  for (const [name, value] of entries) body.append(name, value);
  return new Request(url, { method: "POST", body });
};
const unwrap = (value: unknown) => (value as { data: unknown; init: ResponseInit | null }) ?? null;

describe("route modules", () => {
  test("report pages are never cached", () => {
    for (const route of [draft, start, home]) expect(route.headers()).toEqual({ "cache-control": "private, no-store" });
  });

  test("titles come from the catalogue with the app's name", async () => {
    const meta = (route: { meta: (args: Args) => unknown[] }, loaded: unknown) =>
      route.meta({ data: loaded, matches: [] } as Args)[0];
    const noTopics = { context: { api: api({ "GET /education": json(SAMPLE_FIELD_ERROR, 503) }) } } as Args;
    expect(meta(help, await help.loader(noTopics))).toEqual({ title: "Bantuan, Pantau Bencana BNPB" });
    expect(meta(about, about.loader())).toEqual({ title: "Tentang, Pantau Bencana BNPB" });
    expect(meta(privacy, privacy.loader())).toEqual({ title: "Kebijakan privasi, Pantau Bencana BNPB" });
    for (const route of [draft, start, home]) expect(route.meta({ data: undefined, matches: [] } as Args)).toEqual([]);
  });

  test("the root hands the site's address to every page's links", () => {
    expect(root.loader({ context: { origin: "https://lapor.example.test" } } as Args)).toEqual({
      origin: "https://lapor.example.test",
    });
    expect(root.links().map((link) => (link as { href: string }).href)).toEqual([
      "/favicon-32.png",
      "/apple-touch-icon.png",
    ]);
  });

  test("an unknown address answers 404, is not indexed, and leads back home", async () => {
    const loaded = unwrap(notFound.loader());
    expect(loaded.init?.status).toBe(404);
    expect(notFound.meta({ data: loaded.data, matches: [] } as Args)).toContainEqual({
      name: "robots",
      content: "noindex, nofollow",
    });
    renderPage(routeElement(NotFoundRoute, { loaderData: loaded.data }), { path: "/lapor/nowhere" });
    expect(await screen.findByRole("heading", { name: "Halaman tidak ditemukan" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ke halaman awal" }).getAttribute("href")).toBe("/lapor");
  });

  test("the home reads the open drafts on the server, and survives when it cannot", async () => {
    const read = await home.loader({ context: { api: api({ "GET /me": json(SAMPLE_ME) }) } } as Args);
    expect(read.me).toEqual(SAMPLE_ME);
    const down = await home.loader({ context: { api: api({ "GET /me": json(SAMPLE_FIELD_ERROR, 503) }) } } as Args);
    expect(down.me).toBeNull();
    renderPage(routeElement(HomeRoute, { loaderData: read }), { path: "/lapor" });
    expect(await screen.findByRole("link", { name: "Lapor kejadian" })).toBeTruthy();
  });

  test("the tracking page is never cached or indexed, and reads its report with script", async () => {
    expect(tracking.headers()).toEqual({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });
    const loaded = tracking.loader();
    expect(tracking.meta({ data: loaded, matches: [] } as Args)).toContainEqual({
      title: "Lacak laporan, Pantau Bencana BNPB",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    renderPage(routeElement(TrackingRoute, { loaderData: loaded }), { path: "/lapor/lacak" });
    expect(await screen.findByRole("heading", { level: 1, name: "Laporan tidak ditemukan." })).toBeTruthy();
    vi.unstubAllGlobals();
  });

  test("the text pages render their content", async () => {
    const topics = {
      dataDate: "2026-11-19",
      topics: [
        {
          id: "banjir",
          title: "Banjir",
          summary: "Air meluap.",
          lists: [{ kind: "sebelum", items: ["Siapkan tas siaga"] }],
          sources: [{ organisation: "BNPB", title: "Buku saku", url: "https://bnpb.go.id/" }],
        },
      ],
    };
    const loaded = await help.loader({ context: { api: api({ "GET /education": json(topics) }) } } as Args);
    renderPage(routeElement(HelpRoute, { loaderData: loaded }), { path: "/lapor/help" });
    expect(await screen.findByRole("heading", { level: 2, name: "Istilah" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Edukasi siaga" })).toBeTruthy();
    expect(screen.getByText("Siapkan tas siaga")).toBeTruthy();
    expect(screen.getByRole("link", { name: "BNPB: Buku saku" }).getAttribute("href")).toBe("https://bnpb.go.id/");
    expect(screen.getByText("Topik per 19 November 2026.")).toBeTruthy();
    cleanup();
    const without = await help.loader({
      context: { api: api({ "GET /education": json(SAMPLE_FIELD_ERROR, 503) }) },
    } as Args);
    renderPage(routeElement(HelpRoute, { loaderData: without }), { path: "/lapor/help" });
    expect(await screen.findByText(/Topik edukasi siaga belum bisa dimuat/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Baca kebijakan privasi lengkap" }).getAttribute("href")).toBe(
      "/lapor/privacy",
    );
    renderPage(routeElement(AboutRoute, { loaderData: about.loader() }), { path: "/lapor/about" });
    expect(await screen.findByRole("link", { name: /112 Darurat terpadu/ })).toHaveProperty("href", "tel:112");
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(6);
    renderPage(routeElement(PrivacyRoute, { loaderData: privacy.loader() }), { path: "/lapor/privacy" });
    expect(await screen.findByRole("heading", { level: 2, name: "Hak Anda" })).toBeTruthy();
    expect(screen.getByText("23 November 2026")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Tentang" })[0]?.getAttribute("href")).toBe("/lapor/about");
    expect(screen.getByRole("link", { name: "Hak Anda" }).getAttribute("href")).toBe("#privacy-rights-2");
  });

  test("the start step loads, posts, redirects with a 303, or draws the refusal", async () => {
    const context = {
      api: api({
        "GET /me": json(SAMPLE_ME),
        "POST /consent": () =>
          Response.json({ draftId: DRAFT }, { status: 201, headers: { "set-cookie": "device_key=x" } }),
      }),
    };
    const loaded = await start.loader({ request: new Request("http://x/lapor/report"), context } as Args);
    expect(loaded.view).toBe("list");
    const moved = (await start.action({
      request: post("http://x/lapor/report", [
        ["action", "consent"],
        ["role", "citizen"],
        ["name", "Uji"],
        ["number", "080000000001"],
      ]),
      context,
    } as Args)) as Response;
    expect(moved.status).toBe(303);
    expect(moved.headers.get("location")).toBe(`/lapor/report/${DRAFT}`);
    expect(moved.headers.get("set-cookie")).toBe("device_key=x");
    const drawn = unwrap(
      await start.action({ request: post("http://x/lapor/report", [["action", "decline"]]), context } as Args),
    );
    expect(drawn.data).toMatchObject({ view: "declineConfirm" });
    renderPage(routeElement(StartRoute, { loaderData: loaded, actionData: undefined }), { path: "/lapor/report" });
    expect(await screen.findByRole("heading", { name: "Pilih pelapor" })).toBeTruthy();
  });

  test("the draft page loads with its status, and a turn redirects or comes back refused", async () => {
    const context = {
      api: api({
        [`GET /drafts/${DRAFT}`]: json(SAMPLE_DRAFTS.summary),
        [`POST /drafts/${DRAFT}/turns`]: json(SAMPLE_FIELD_ERROR, 422),
        [`POST /drafts/${DRAFT}/send`]: json({ ticketNumber: "LA-231126-01" }, 201),
      }),
    };
    const loaded = unwrap(
      await draft.loader({
        params: { draftId: DRAFT },
        request: new Request(`http://x/lapor/report/${DRAFT}`),
        context,
      } as Args),
    );
    expect(loaded.data).toMatchObject({ kind: "draft", searching: false });
    const sent = (await draft.action({
      params: { draftId: DRAFT },
      request: post(`http://x/lapor/report/${DRAFT}`, [["action", "send"]]),
      context,
    } as Args)) as Response;
    expect([sent.status, sent.headers.get("X-Remix-Replace")]).toEqual([303, "true"]);
    const refused = unwrap(
      await draft.action({
        params: { draftId: DRAFT },
        request: post(`http://x/lapor/report/${DRAFT}`, [["dead", "x"]]),
        context,
      } as Args),
    );
    expect(refused.init?.status).toBe(422);
    renderPage(routeElement(DraftRoute, { loaderData: loaded.data, actionData: undefined }));
    expect(await screen.findByRole("heading", { name: "Ringkasan laporan" })).toBeTruthy();
  });

  test("a draft that cannot be opened is drawn as its card", async () => {
    const context = {
      api: api({
        [`GET /drafts/${DRAFT}`]: json(
          { ...SAMPLE_FIELD_ERROR, error: { code: "draft.notFound", copyKey: "error.draft.notFound", params: {} } },
          404,
        ),
      }),
    };
    const loaded = unwrap(
      await draft.loader({
        params: { draftId: DRAFT },
        request: new Request(`http://x/lapor/report/${DRAFT}`),
        context,
      } as Args),
    );
    expect(loaded.init?.status).toBe(404);
    renderPage(routeElement(DraftRoute, { loaderData: loaded.data }));
    expect(await screen.findByRole("heading", { level: 1, name: /Laporan tidak ditemukan/ })).toBeTruthy();
  });

  test("with script a lost turn keeps the page and its turn key; any other answer passes", async () => {
    const request = post("http://x/", [["text", "air naik"]]);
    const lost = await draft.clientAction({
      request,
      serverAction: () => Promise.reject(new TypeError("offline")),
    } as Args);
    expect(lost).toEqual({ envelope: null, posted: { text: ["air naik"] }, networkLost: true });
    const answered = { envelope: null, posted: {}, networkLost: false };
    expect(
      await draft.clientAction({ request: post("http://x/", []), serverAction: async () => answered } as Args),
    ).toBe(answered);
    expect(draft.shouldRevalidate({ actionResult: LOST, defaultShouldRevalidate: true } as Args)).toBe(false);
    expect(draft.shouldRevalidate({ actionResult: answered, defaultShouldRevalidate: true } as Args)).toBe(true);
    expect(never).toBeTypeOf("function");
  });
});
