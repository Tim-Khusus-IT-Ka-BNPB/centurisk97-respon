import { cleanup, screen } from "@testing-library/react";
import { createElement, type FC } from "react";
import { describe, expect, test, vi } from "vitest";
import type { ApiCall } from "../../src/api/bridge";
import { envelope as apiEnvelope } from "../../src/api/envelope";
import { SAMPLE_DRAFTS, SAMPLE_FIELD_ERROR, SAMPLE_ME } from "../../src/testing/samples";
import { LOST } from "../lib/network";
import { PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import * as root from "../root";
import { SUMMARY } from "../testing/desk";
import { FEED_ENTRY } from "../testing/feed";
import { OUTLOOK } from "../testing/outlook";
import { OWN_REPORT } from "../testing/ownReport";
import { never, renderPage } from "../testing/render";
import AboutRoute, * as about from "./about";
import DeskRoute, * as desk from "./desk";
import * as deskAggregates from "./deskAggregates";
import * as deskDocument from "./deskDocument";
import DeskPilotRoute, * as deskPilot from "./deskPilot";
import DeskReportRoute, * as deskReport from "./deskReport";
import DeskResponseRoute, * as deskResponse from "./deskResponse";
import DraftRoute, * as draft from "./draft";
import EmergencyRoute, * as emergency from "./emergency";
import FeedRoute, * as feed from "./feed";
import HelpRoute, * as help from "./help";
import HomeRoute, * as home from "./home";
import * as rootIndex from "./index";
import InfoRoute, * as info from "./info";
import * as language from "./language";
import * as manifest from "./manifest";
import NotFoundRoute, * as notFound from "./notFound";
import * as ownDocument from "./ownDocument";
import OwnReportRoute, * as ownReport from "./ownReport";
import PosterRoute, * as poster from "./poster";
import PrivacyRoute, * as privacy from "./privacy";
import StartRoute, * as start from "./start";
import * as theme from "./theme";
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
    expect(
      root.loader({
        request: new Request("https://lapor.example.test/lapor", { headers: { cookie: "theme=dark" } }),
        context: { origin: "https://lapor.example.test" },
      } as Args),
    ).toEqual({ origin: "https://lapor.example.test", theme: "dark" });
    expect(root.links().map((link) => (link as { href: string }).href)).toEqual([
      "/favicon-32.png",
      "/apple-touch-icon.png",
      "/lapor/manifest.webmanifest",
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

  test("the app installs with its name, icons and three ways in from the home screen", async () => {
    const answer = manifest.loader();
    expect(answer.headers.get("content-type")).toBe("application/manifest+json");
    const body = (await answer.json()) as {
      name: string;
      start_url: string;
      icons: unknown[];
      shortcuts: { url: string }[];
    };
    expect(body).toMatchObject({
      name: "Pantau Bencana BNPB",
      short_name: "Pantau Bencana",
      start_url: "/lapor",
      display: "standalone",
    });
    expect(body.icons).toHaveLength(3);
    expect(body.shortcuts.map((one) => one.url)).toEqual(["/lapor/report", "/lapor/report?darurat=1", "/lapor/feed"]);
  });

  test("the village posters: a search, a district, one village of it, and a list that cannot be read", async () => {
    expect(poster.headers()).toEqual({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });
    expect(poster.meta({ data: { texts: pickTexts(PAGE_TEXTS.poster) }, matches: [] } as Args)[0]).toEqual({
      title: "Poster QR desa, Pantau Bencana BNPB",
    });
    const area = {
      items: [
        {
          level: "village",
          code: "11.08.01.2001",
          name: "Uji Satu",
          districtName: "Baktiya",
          regencyName: "Aceh Utara",
          provinceName: "Aceh",
        },
      ],
      total: 1,
      cut: false,
      dataDate: "2026-11-01",
      area: { level: "district", code: "11.08.01", name: "Baktiya", regencyName: "Aceh Utara", provinceName: "Aceh" },
    };
    const asked: string[] = [];
    const answering =
      (response: () => Response): ApiCall =>
      async (_method, path) => {
        asked.push(path);
        return response();
      };
    const load = (query: string, response: () => Response = json(area)) =>
      poster.loader({
        request: new Request(`http://localhost/lapor/poster${query}`),
        context: { api: answering(response) },
      } as Args);
    expect((await load("")).load).toEqual({ kind: "start", query: "" });
    expect((await load("?q=ab")).load).toEqual({ kind: "short", query: "ab" });
    expect((await load("?q=baktiya")).load).toMatchObject({ kind: "results", query: "baktiya" });
    expect((await load("?q=baktiya", json({}, 503))).load).toEqual({ kind: "unavailable", query: "baktiya" });
    expect((await load("?district=11.08.01")).load).toMatchObject({ kind: "sheets", one: false, cut: false });
    expect((await load("?district=11.08.01&village=11.08.01.2001")).load).toMatchObject({ kind: "sheets", one: true });
    expect((await load("?district=11.08.01&village=11.08.01.9999")).load).toMatchObject({ kind: "sheets", one: false });
    expect((await load("?district=11.08.01", json({}, 503))).load).toEqual({ kind: "unavailable", query: "" });
    expect(asked).toContain("/places/search?q=baktiya");
    expect(asked).toContain("/places/districts/11.08.01/villages?q=");
    const shown = await load("?district=11.08.01");
    renderPage(routeElement(PosterRoute, { loaderData: shown }), { path: "/lapor/poster" });
    expect(await screen.findByRole("heading", { level: 1, name: "Poster QR desa" })).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  test("the regional outlook: a search by regency, an outlook, one the file has not, and one that cannot be read", async () => {
    expect(info.meta({ data: { texts: pickTexts(PAGE_TEXTS.info) }, matches: [] } as Args)[0]).toEqual({
      title: "Info daerah, Pantau Bencana BNPB",
    });
    const place = (level: string, code: string, name: string) => ({
      level,
      code,
      name,
      districtName: level === "regency" ? null : "Baktiya",
      regencyName: "Aceh Utara",
      provinceName: "Aceh",
    });
    const found = {
      items: [
        place("regency", "11.08", "Aceh Utara"),
        place("district", "11.08.01", "Baktiya"),
        place("village", "11.06.01.2001", "Uji"),
      ],
      total: 3,
      cut: false,
      dataDate: "2026-11-01",
    };
    const asked: string[] = [];
    const load = async (query: string, response: () => Response) =>
      (
        await info.loader({
          request: new Request(`http://localhost/lapor/info${query}`),
          context: {
            api: async (_method: string, path: string) => {
              asked.push(path);
              return response();
            },
          },
        } as Args)
      ).load;
    const none = json({}, 500);
    expect(await load("", none)).toEqual({ kind: "start", query: "" });
    expect(await load("?kab=1108", none)).toEqual({ kind: "start", query: "" });
    expect(await load("?q=ab", none)).toEqual({ kind: "short", query: "ab" });
    expect(await load("?q=aceh", json(found))).toEqual({
      kind: "results",
      query: "aceh",
      regencies: [
        { code: "11.08", name: "Aceh Utara", provinceName: "Aceh" },
        { code: "11.06", name: "Aceh Utara", provinceName: "Aceh" },
      ],
    });
    expect(await load("?q=aceh", json({}, 503))).toEqual({ kind: "unavailable", query: "aceh" });
    expect(await load("?kab=11.08", json(OUTLOOK))).toEqual({ kind: "outlook", query: "", outlook: OUTLOOK });
    expect(await load("?kab=99.99", json({}, 404))).toEqual({ kind: "none", query: "" });
    expect(await load("?kab=11.08", json({}, 503))).toEqual({ kind: "unavailable", query: "" });
    expect(asked).toEqual([
      "/places/search?q=aceh",
      "/places/search?q=aceh",
      "/outlook?regency=11.08",
      "/outlook?regency=99.99",
      "/outlook?regency=11.08",
    ]);
    renderPage(
      routeElement(InfoRoute, {
        loaderData: { load: { kind: "start", query: "" }, texts: pickTexts(PAGE_TEXTS.info) },
      }),
      {
        path: "/lapor/info",
      },
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Info daerah" })).toBeTruthy();
  });

  test("the public feed is read on the server with only a known hazard, and says when it cannot be", async () => {
    expect(feed.headers()).toEqual({ "cache-control": "private, no-store" });
    const asked: string[] = [];
    const answering =
      (response: () => Response): ApiCall =>
      async (_method, path) => {
        asked.push(path);
        return response();
      };
    const read = await feed.loader({
      request: new Request("http://localhost/lapor/feed?hazard=flood"),
      context: { api: answering(json({ entries: [FEED_ENTRY] })) },
    } as Args);
    expect(read).toMatchObject({ load: { kind: "feed", feed: { entries: [FEED_ENTRY] } }, hazard: "flood" });
    await feed.loader({
      request: new Request("http://localhost/lapor/feed?hazard=other"),
      context: { api: answering(json({ entries: [] })) },
    } as Args);
    expect(asked).toEqual(["/feed?hazard=flood", "/feed"]);
    const limited = apiEnvelope("limit.address.feed", { params: { limit: 600 } });
    const refused = await feed.loader({
      request: new Request("http://localhost/lapor/feed"),
      context: { api: answering(json(limited, 429)) },
    } as Args);
    expect(refused.load).toEqual({ kind: "unavailable", envelope: limited });
    const broken = await feed.loader({
      request: new Request("http://localhost/lapor/feed"),
      context: { api: answering(() => new Response("down", { status: 503 })) },
    } as Args);
    expect(broken.load).toEqual({ kind: "unavailable", envelope: null });
    expect(feed.meta({ data: read, matches: [] } as Args)).toContainEqual({ title: "Alun-alun, Pantau Bencana BNPB" });
    renderPage(routeElement(FeedRoute, { loaderData: read }), { path: "/lapor/feed" });
    expect(await screen.findByRole("heading", { level: 1, name: "Alun-alun" })).toBeTruthy();
  });

  test("the home reads the open drafts on the server, and survives when it cannot", async () => {
    const read = await home.loader({ context: { api: api({ "GET /me": json(SAMPLE_ME) }) } } as Args);
    expect(read.me).toEqual(SAMPLE_ME);
    const down = await home.loader({ context: { api: api({ "GET /me": json(SAMPLE_FIELD_ERROR, 503) }) } } as Args);
    expect(down.me).toBeNull();
    renderPage(routeElement(HomeRoute, { loaderData: read }), { path: "/lapor" });
    expect(await screen.findByRole("link", { name: "Lapor kejadian" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lapor darurat" }).getAttribute("href")).toBe("/lapor/report?darurat=1");
    // One tap is offered only where a reporter is known.
    expect(screen.getByRole("link", { name: "Darurat sekali ketuk" }).getAttribute("href")).toBe(
      "/lapor/darurat?ketuk=1",
    );
    cleanup();
    renderPage(routeElement(HomeRoute, { loaderData: down }), { path: "/lapor" });
    expect(await screen.findByRole("link", { name: "Lapor darurat" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Darurat sekali ketuk" })).toBeNull();
  });

  test("a report's own page is read on the server, private; a refused one answers with its status", async () => {
    expect(ownReport.headers()).toEqual({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });
    const params = { ticketNumber: "LA-231126-01" };
    const path = "/reports/LA-231126-01";
    const loaded = unwrap(
      await ownReport.loader({ params, context: { api: api({ [`GET ${path}`]: json(OWN_REPORT) }) } } as Args),
    );
    expect(loaded.init?.status).toBe(200);
    expect(ownReport.meta({ data: loaded.data, matches: [] } as Args)).toContainEqual({
      title: "Laporan saya, Pantau Bencana BNPB",
    });
    renderPage(routeElement(OwnReportRoute, { loaderData: loaded.data }), { path: "/lapor/reports/LA-231126-01" });
    expect(await screen.findByRole("heading", { level: 1, name: "LA-231126-01" })).toBeTruthy();
    cleanup();

    const missing = json(apiEnvelope("report.notFound"), 404);
    const refused = unwrap(
      await ownReport.loader({ params, context: { api: api({ [`GET ${path}`]: missing }) } } as Args),
    );
    expect(refused.init?.status).toBe(404);
    renderPage(routeElement(OwnReportRoute, { loaderData: refused.data }), { path: "/lapor/reports/LA-231126-01" });
    expect(await screen.findByRole("heading", { level: 1, name: "Laporan tidak ditemukan" })).toBeTruthy();
  });

  test("news is started by a post that leads to its draft, or drawn with its refusal", async () => {
    const params = { ticketNumber: "LA-231126-01" };
    const path = "POST /reports/LA-231126-01/follow-ups";
    const request = (action: string) => post("http://localhost/lapor/reports/LA-231126-01", [["action", action]]);
    const act = (answer: () => Response) =>
      ownReport.action({ params, request: request("followUp"), context: { api: api({ [path]: answer }) } } as Args);
    const read = () => new Response(null, { status: 204 });
    expect(
      await ownReport.action({
        params,
        request: request("newsRead"),
        context: { api: api({ "POST /reports/LA-231126-01/news": read }) },
      } as Args),
    ).toBeNull();
    // Read news keeps its marks for this visit; any other act reads the page again.
    const revalidates = (action: string | null) => {
      const formData = new FormData();
      if (action !== null) formData.set("action", action);
      return ownReport.shouldRevalidate({
        formData: action === null ? undefined : formData,
        defaultShouldRevalidate: true,
      } as Args);
    };
    expect([revalidates("newsRead"), revalidates("newsStop"), revalidates(null)]).toEqual([false, true, true]);
    const started = (await act(json({ draftId: "d-9" }, 201))) as Response;
    expect([started.status, started.headers.get("location")]).toEqual([303, "/lapor/report/d-9"]);
    const closed = apiEnvelope("followUp.closed", { params: { reason: "followUp.closed.tooLate" } });
    const refused = unwrap(await act(json(closed, 409)));
    expect(refused.init?.status).toBe(409);
    const loaded = unwrap(
      await ownReport.loader({
        params,
        context: { api: api({ "GET /reports/LA-231126-01": json(OWN_REPORT) }) },
      } as Args),
    );
    renderPage(routeElement(OwnReportRoute, { loaderData: loaded.data, actionData: refused.data }), {
      path: "/lapor/reports/LA-231126-01",
    });
    expect((await screen.findByRole("alert")).textContent).toContain("72 jam");
  });

  test("a draft of news that is over leads back to its report", async () => {
    const ended = SAMPLE_DRAFTS.followUpEnded;
    const answer = draft.loader({
      params: { draftId: ended.draftId },
      request: new Request(`http://localhost/lapor/report/${ended.draftId}`),
      context: { api: api({ [`GET /drafts/${ended.draftId}`]: json(ended) }) },
    } as Args);
    const thrown = (await answer.catch((response: unknown) => response)) as Response;
    expect([thrown.status, thrown.headers.get("location")]).toEqual([303, "/lapor/reports/LA-231126-01?saved=sent"]);
  });

  test("documents are files, read by the reporter and posted for by staff", async () => {
    const file = () => new Response("isi");
    const own = await ownDocument.loader({
      params: { ticketNumber: "LA-1", file: "v1.pdf" },
      context: { api: api({ "GET /reports/LA-1/documents/1/pdf": file }) },
    } as Args);
    expect(await own.text()).toBe("isi");
    const staff = await deskDocument.action({
      params: { ticketNumber: "LA-1" },
      request: post("http://localhost/lapor/meja/LA-1/documents", [
        ["version", "1"],
        ["format", "docx"],
      ]),
      context: { api: api({ "POST /desk/reports/LA-1/documents": file }) },
    } as Args);
    expect(await staff.text()).toBe("isi");
  });

  test("one tap is for a reporter known here; anyone else goes to the short conversation", async () => {
    expect(emergency.headers()).toEqual({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });
    const start = { name: "Uji Satu", maskedNumber: "0800****0001", contact: { level: "national" } };
    const loaded = await emergency.loader({
      context: { api: api({ "GET /emergencies/start": json(start) }) },
    } as Args);
    const titles = emergency
      .meta({ data: loaded, matches: [] } as Args)
      .map((tag) => (tag as { title?: string }).title);
    expect(titles.find(Boolean)).toMatch(/^Darurat sekali ketuk/);
    renderPage(routeElement(EmergencyRoute, { loaderData: loaded }), { path: "/lapor/darurat" });
    expect(await screen.findByRole("heading", { level: 1, name: "Darurat sekali ketuk" })).toBeTruthy();
    const stranger = await emergency.loader({
      context: { api: api({ "GET /emergencies/start": json(SAMPLE_FIELD_ERROR, 401) }) },
    } as Args);
    expect((stranger as Response).headers.get("location")).toBe("/lapor/report?darurat=1");
  });

  test("the tracking page is never cached or indexed, and reads its report with script", async () => {
    expect(tracking.headers()).toEqual({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });
    const loaded = tracking.loader();
    expect(tracking.meta({ data: loaded, matches: [] } as Args)).toContainEqual({
      title: "Lacak laporan, Pantau Bencana BNPB",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(apiEnvelope("tracking.notFound"), { status: 404 })),
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
      request: post("http://x/lapor/report?desa=1108012005", [
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
    cleanup();
    // "Lapor darurat" opens the same page, saying the way is short, with 112 at hand.
    const alarmed = await start.loader({
      request: new Request("http://x/lapor/report?darurat=1"),
      context,
    } as Args);
    renderPage(routeElement(StartRoute, { loaderData: alarmed, actionData: undefined }), {
      path: "/lapor/report",
      entry: "/lapor/report?darurat=1",
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Lapor darurat" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /112/ }).getAttribute("href")).toBe("tel:112");
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

describe("desk routes", () => {
  const QUEUE = { account: { label: "Petugas Uji" }, items: [], total: 0, page: 1, pageCount: 0 };
  const signInFirst = {
    error: { code: "auth.staffSignInFirst", copyKey: "error.auth.staffSignInFirst", params: {} },
    fields: [],
    retryAt: null,
    draft: null,
  };
  const notAllowed = {
    ...signInFirst,
    error: { code: "desk.notAllowed", copyKey: "error.desk.notAllowed", params: {} },
  };

  test("desk pages are private, not indexed, and titled from the catalogue", () => {
    for (const route of [desk, deskReport])
      expect(route.headers()).toEqual({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });
    expect(desk.meta({ data: { texts: pickTexts(PAGE_TEXTS.desk) }, matches: [] } as Args)[0]).toEqual({
      title: "Meja laporan, Pantau Bencana BNPB",
    });
    expect(deskReport.meta({ data: { texts: pickTexts(PAGE_TEXTS.desk) }, matches: [] } as Args)[0]).toEqual({
      title: "Meja laporan, Pantau Bencana BNPB",
    });
  });

  test("the queue, the sign-in form, and a refusal with its status", async () => {
    const load = async (answer: () => Response) =>
      unwrap(
        await desk.loader({
          request: new Request("http://x/lapor/meja?view=list"),
          context: { api: api({ "GET /desk/reports": answer, "GET /desk/summary": json(SUMMARY) }) },
        } as Args),
      );
    const queue = await load(json(QUEUE));
    expect(queue.init?.status).toBe(200);
    renderPage(routeElement(DeskRoute, { loaderData: queue.data, actionData: undefined }), { path: "/lapor/meja" });
    expect(await screen.findAllByText("Masuk sebagai Pusdalops BNPB, Petugas Uji")).toHaveLength(2);
    cleanup();
    const signIn = await load(json(signInFirst, 401));
    renderPage(routeElement(DeskRoute, { loaderData: signIn.data, actionData: undefined }), { path: "/lapor/meja" });
    expect(await screen.findByRole("heading", { name: "Masuk meja laporan" })).toBeTruthy();
    cleanup();
    const refused = await load(json(notAllowed, 403));
    expect(refused.init?.status).toBe(403);
    renderPage(routeElement(DeskRoute, { loaderData: refused.data, actionData: undefined }), { path: "/lapor/meja" });
    expect(await screen.findByRole("heading", { name: "Meja laporan belum bisa dibuka" })).toBeTruthy();
  });

  test("the response figures, the sign-in form, and a refusal with its status", async () => {
    expect(deskResponse.headers()).toEqual({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });
    expect(deskResponse.meta({ data: { texts: pickTexts(PAGE_TEXTS.desk) }, matches: [] } as Args)[0]).toEqual({
      title: "Meja laporan, Pantau Bencana BNPB",
    });
    const load = async (answer: () => Response) =>
      unwrap(
        await deskResponse.loader({
          request: new Request("http://x/lapor/meja/respons?month=2026-11"),
          context: {
            api: api({
              "GET /desk/response": answer,
              "GET /desk/summary": json(SUMMARY),
              "GET /desk/warnings": json({ open: true, paused: false, by: null, at: null, phones: 3 }),
            }),
          },
        } as Args),
      );
    const show = (loaderData: unknown) =>
      renderPage(routeElement(DeskResponseRoute, { loaderData }), { path: "/lapor/meja/respons" });
    show((await load(json({ account: { label: "Petugas Uji" }, month: "2026-11", agencies: [] }))).data);
    expect(await screen.findByRole("heading", { level: 1, name: "Respons BPBD" })).toBeTruthy();
    cleanup();
    show((await load(json(signInFirst, 401))).data);
    expect(await screen.findByRole("heading", { name: "Masuk meja laporan" })).toBeTruthy();
    cleanup();
    const refused = await load(json(notAllowed, 403));
    expect(refused.init?.status).toBe(403);
    show(refused.data);
    expect(await screen.findByRole("heading", { name: "Meja laporan belum bisa dibuka" })).toBeTruthy();
    const csv = () => new Response("minggu\n", { headers: { "content-type": "text/csv" } });
    const file = await deskAggregates.action({ context: { api: api({ "POST /desk/aggregates": csv }) } } as Args);
    expect(await file.text()).toBe("minggu\n");
    const barred = await deskAggregates.action({
      context: { api: api({ "POST /desk/aggregates": json(notAllowed, 403) }) },
    } as Args);
    expect([barred.status, barred.headers.get("location")]).toEqual([303, "/lapor/meja/respons?refused=aggregates"]);
    const pause = async (answer: () => Response, url: string) => {
      const body = new FormData();
      body.set("paused", "1");
      const done = (await deskResponse.action({
        request: new Request(url, { method: "POST", body }),
        context: { api: api({ "POST /desk/warnings": answer }) },
      } as Args)) as Response;
      return [done.status, done.headers.get("location")];
    };
    expect(await pause(json({}), "http://x/lapor/meja/respons?month=2026-10&refused=warnings")).toEqual([
      303,
      "/lapor/meja/respons?month=2026-10",
    ]);
    expect(await pause(json(notAllowed, 403), "http://x/lapor/meja/respons")).toEqual([
      303,
      "/lapor/meja/respons?refused=warnings",
    ]);
  });

  test("the pilot's numbers: the page, the sign-in form, a refusal, and its forms", async () => {
    expect(deskPilot.headers()).toEqual({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });
    expect(deskPilot.meta({ data: { texts: pickTexts(PAGE_TEXTS.desk) }, matches: [] } as Args)[0]).toEqual({
      title: "Meja laporan, Pantau Bencana BNPB",
    });
    const load = async (answer: () => Response) =>
      unwrap(
        await deskPilot.loader({
          context: { api: api({ "GET /desk/pilot": answer, "GET /desk/summary": json(SUMMARY) }) },
        } as Args),
      );
    const show = (loaderData: unknown, actionData?: unknown) =>
      renderPage(routeElement(DeskPilotRoute, { loaderData, actionData }), { path: "/lapor/meja/pilot" });
    const list = json({ account: { label: "Petugas Uji" }, max: 500, items: [] });
    show((await load(list)).data);
    expect(await screen.findByRole("heading", { level: 1, name: "Nomor uji WhatsApp" })).toBeTruthy();
    cleanup();
    show((await load(json(signInFirst, 401))).data);
    expect(await screen.findByRole("heading", { name: "Masuk meja laporan" })).toBeTruthy();
    cleanup();
    const refused = await load(json(notAllowed, 403));
    expect(refused.init?.status).toBe(403);
    show(refused.data);
    expect(await screen.findByRole("heading", { name: "Meja laporan belum bisa dibuka" })).toBeTruthy();
    cleanup();
    const posted = (answer: () => Response) =>
      deskPilot.action({
        request: post("http://x/lapor/meja/pilot", [
          ["action", "add"],
          ["number", "12"],
        ]),
        context: { api: api({ "POST /desk/pilot": answer }) },
      } as Args);
    const done = (await posted(json({}))) as Response;
    expect([done.status, done.headers.get("location")]).toEqual([303, "/lapor/meja/pilot?saved=allowed"]);
    const again = unwrap(await posted(json(notAllowed, 403)));
    expect(again.init?.status).toBe(403);
    show((await load(list)).data, again.data);
    expect(((await screen.findByLabelText("Nomor WhatsApp")) as HTMLInputElement).value).toBe("12");
  });

  test("signing in redirects with the cookie; a refused code renders with its status", async () => {
    const signed = await desk.action({
      request: post("http://x/lapor/meja", [["code", "abc"]]),
      context: {
        api: api({ "POST /desk/session": () => new Response(null, { status: 204, headers: { "set-cookie": "s=1" } }) }),
      },
    } as Args);
    expect((signed as Response).status).toBe(303);
    expect((signed as Response).headers.get("set-cookie")).toBe("s=1");
    const refused = unwrap(
      await desk.action({
        request: post("http://x/lapor/meja", [["code", "x"]]),
        context: { api: api({ "POST /desk/session": json(signInFirst, 422) }) },
      } as Args),
    );
    expect(refused.init?.status).toBe(422);
  });

  test("a report, the sign-in form, a refusal, and an open posted then redirected", async () => {
    const REPORT = {
      ticketNumber: "LA-241126-01",
      status: "seen",
      hazardType: "flood",
      hazardSubtype: "unknown",
      place: { villageName: "A", districtName: "B", regencyName: "C" },
      eventTime: { kind: "olderThan30Days" },
      sentAt: { utc: "2026-11-24T02:30:00.000Z", zone: "WIB" },
      completePercent: 50,
      cluster: null,
      photoCount: 0,
      numberUnverified: false,
      emergency: null,
      offline: null,
      taker: null,
      account: { label: "Petugas Uji" },
      reporter: {
        role: "citizen",
        identity: { name: "Uji Satu", number: "+6280000000001", officerRegency: null, officerPosition: null },
      },
      groups: [],
      history: [],
      reporterWords: [],
      photos: [],
      videos: [],
      event: null,
      nextStatuses: [],
      revision: 0,
      mayTake: false,
      point: null,
      revisable: [],
      chatNews: null,
      offeredActions: [],
      actions: [],
      proofs: [],
      replies: [],
      versions: [],
      impact: { dead: null, missing: null, injured: null, displaced: null, houses: null },
    };
    const load = async (answer: () => Response) =>
      unwrap(
        await deskReport.loader({
          params: { ticketNumber: "LA-241126-01" },
          context: { api: api({ "GET /desk/reports/LA-241126-01": answer, "GET /desk/summary": json(SUMMARY) }) },
        } as Args),
      );
    const read = await load(json(REPORT));
    renderPage(routeElement(DeskReportRoute, { loaderData: read.data, actionData: undefined }), {
      path: "/lapor/meja/x",
    });
    expect(await screen.findByRole("heading", { name: "LA-241126-01" })).toBeTruthy();
    cleanup();
    const signIn = await load(json(signInFirst, 401));
    renderPage(routeElement(DeskReportRoute, { loaderData: signIn.data, actionData: undefined }), {
      path: "/lapor/meja/x",
    });
    expect(await screen.findByRole("heading", { name: "Masuk meja laporan" })).toBeTruthy();
    cleanup();
    const refused = await load(json(notAllowed, 404));
    expect(refused.init?.status).toBe(404);
    renderPage(routeElement(DeskReportRoute, { loaderData: refused.data, actionData: undefined }), {
      path: "/lapor/meja/x",
    });
    expect(await screen.findByRole("heading", { name: "Meja laporan belum bisa dibuka" })).toBeTruthy();
    cleanup();
    const missing = await load(
      json({ ...notAllowed, error: { ...notAllowed.error, code: "desk.reportNotFound" } }, 404),
    );
    renderPage(routeElement(DeskReportRoute, { loaderData: missing.data, actionData: undefined }), {
      path: "/lapor/meja/x",
    });
    expect(await screen.findByRole("heading", { name: "Laporan tidak ditemukan" })).toBeTruthy();
    cleanup();
    // A refused open shows above the report it was for.
    renderPage(
      routeElement(DeskReportRoute, {
        loaderData: read.data,
        actionData: { envelope: notAllowed, typed: null, identity: null },
      }),
      {
        path: "/lapor/meja/LA-241126-01",
      },
    );
    expect((await screen.findByRole("alert")).textContent).toContain("belum berhak");
    const viewed = await deskReport.action({
      params: { ticketNumber: "LA-241126-01" },
      request: post("http://x/lapor/meja/LA-241126-01", []),
      context: { api: api({ "POST /desk/reports/LA-241126-01/view": json(REPORT) }) },
    } as Args);
    expect((viewed as Response).headers.get("location")).toBe("/lapor/meja/LA-241126-01");
    const opened = await deskReport.action({
      params: { ticketNumber: "LA-241126-01" },
      request: post("http://x/lapor/meja/LA-241126-01", [["action", "opened"]]),
      context: { api: api({ "POST /desk/reports/LA-241126-01/view": json(REPORT) }) },
    } as Args);
    expect(opened).toBeNull();
    const who = { name: "Uji Satu", number: "+6280000000001", officerRegency: null, officerPosition: null };
    const asked = unwrap(
      await deskReport.action({
        params: { ticketNumber: "LA-241126-01" },
        request: post("http://x/lapor/meja/LA-241126-01", [["action", "identity"]]),
        context: { api: api({ "POST /desk/reports/LA-241126-01/identity": json(who) }) },
      } as Args),
    );
    expect(asked.data).toEqual({ envelope: null, typed: null, identity: who });
    const limited = unwrap(
      await deskReport.action({
        params: { ticketNumber: "LA-241126-01" },
        request: post("http://x/lapor/meja/LA-241126-01", []),
        context: { api: api({ "POST /desk/reports/LA-241126-01/view": json(notAllowed, 403) }) },
      } as Args),
    );
    expect(limited.init?.status).toBe(403);
  });
});

describe("theme route", () => {
  test("keeps the choice through the API and returns to the page; a strange return goes home", async () => {
    const calls: unknown[] = [];
    const answer: ApiCall = async (_method, path, body) => {
      calls.push([path, body]);
      return new Response(null, { status: 204, headers: { "set-cookie": "theme=dark; Path=/" } });
    };
    const done = (await theme.action({
      request: post("http://x/lapor/theme", [
        ["theme", "dark"],
        ["back", "/lapor/meja?view=map"],
      ]),
      context: { api: answer },
    } as Args)) as Response;
    expect(calls).toEqual([["/preferences/theme", { theme: "dark" }]]);
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe("/lapor/meja?view=map");
    expect(done.headers.get("set-cookie")).toBe("theme=dark; Path=/");
    const away = (await theme.action({
      request: post("http://x/lapor/theme", [
        ["theme", "dark"],
        ["back", "https://evil.example"],
      ]),
      context: { api: answer },
    } as Args)) as Response;
    expect(away.headers.get("location")).toBe("/lapor");
  });
});

describe("language route", () => {
  test("keeps the choice through the API and returns to the report page", async () => {
    const calls: unknown[] = [];
    const answer: ApiCall = async (_method, path, body) => {
      calls.push([path, body]);
      return new Response(null, { status: 204, headers: { "set-cookie": "bahasa=ace; Path=/" } });
    };
    const done = (await language.action({
      request: post("http://x/lapor/bahasa", [
        ["language", "ace"],
        ["back", "/lapor/report?desa=1108012005"],
      ]),
      context: { api: answer },
    } as Args)) as Response;
    expect(calls).toEqual([["/preferences/language", { language: "ace" }]]);
    expect([done.status, done.headers.get("location"), done.headers.get("set-cookie")]).toEqual([
      303,
      "/lapor/report?desa=1108012005",
      "bahasa=ace; Path=/",
    ]);
  });
});

describe("the site root", () => {
  test("leads to the service under /lapor", () => {
    const answer = rootIndex.loader() as Response;
    expect(answer.status).toBe(302);
    expect(answer.headers.get("location")).toBe("/lapor");
  });
});
