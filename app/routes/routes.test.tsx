import { cleanup, screen, within } from "@testing-library/react";
import { createElement, type FC } from "react";
import { describe, expect, test, vi } from "vitest";
import type { ApiCall } from "../../src/api/bridge";
import { envelope as apiEnvelope } from "../../src/api/envelope";
import { SAMPLE_DRAFTS, SAMPLE_FIELD_ERROR, SAMPLE_ME } from "../../src/testing/samples";
import { LOST } from "../lib/network";
import { PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import * as root from "../root";
import { CASE_VIEW } from "../testing/cases";
import { SUMMARY } from "../testing/desk";
import { FEED_ENTRY, TODAY, WATCH } from "../testing/feed";
import { OUTLOOK } from "../testing/outlook";
import { OWN_REPORT } from "../testing/ownReport";
import { never, renderPage } from "../testing/render";
import AboutRoute, * as about from "./about";
import CaseFileRoute, * as caseFile from "./caseFile";
import CaseJoinRoute, * as caseJoin from "./caseJoin";
import DeskRoute, * as desk from "./desk";
import * as deskAggregates from "./deskAggregates";
import * as deskDocument from "./deskDocument";
import DeskMissingRoute, * as deskMissing from "./deskMissing";
import DeskNumbersRoute, * as deskNumbers from "./deskNumbers";
import DeskReportRoute, * as deskReport from "./deskReport";
import DeskResponseRoute, * as deskResponse from "./deskResponse";
import DraftRoute, * as draft from "./draft";
import EmergencyRoute, * as emergency from "./emergency";
import FeedRoute, * as feed from "./feed";
import FeedCardRoute, * as feedCard from "./feedCard";
import HelpRoute, * as help from "./help";
import HomeRoute, * as home from "./home";
import InfoRoute, * as info from "./info";
import LanguageRoute, * as language from "./language";
import * as manifest from "./manifest";
import MissingRoute, * as missing from "./missing";
import NotFoundRoute, * as notFound from "./notFound";
import NumbersRoute, * as numbers from "./numbers";
import * as ownDocument from "./ownDocument";
import OwnReportRoute, * as ownReport from "./ownReport";
import PosterRoute, * as poster from "./poster";
import PrivacyRoute, * as privacy from "./privacy";
import StartRoute, * as start from "./start";
import * as theme from "./theme";
import TodayRoute, * as today from "./today";
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
const homeLoaderIn = (cookie: string) =>
  home.loader({
    request: visit("/", cookie),
    context: { api: api({ "GET /me": json(SAMPLE_ME), "GET /missing/mine": json([]) }) },
  } as Args);
// A visitor's request, in the language their cookie names.
const visit = (path = "/", cookie = "") => new Request(`http://x${path}`, cookie ? { headers: { cookie } } : {});

describe("route modules", () => {
  test("report pages are never cached", () => {
    for (const route of [draft, start, home]) expect(route.headers()).toEqual({ "cache-control": "private, no-store" });
  });

  test("titles come from the catalogue with the app's name", async () => {
    const meta = (route: { meta: (args: Args) => unknown[] }, loaded: unknown) =>
      route.meta({ data: loaded, matches: [] } as Args)[0];
    const noTopics = {
      request: visit(),
      context: { api: api({ "GET /education": json(SAMPLE_FIELD_ERROR, 503) }) },
    } as Args;
    expect(meta(help, await help.loader(noTopics))).toEqual({ title: "Bantuan, Pantau Bencana BNPB" });
    expect(meta(about, about.loader({ request: visit() } as Args))).toEqual({ title: "Tentang, Pantau Bencana BNPB" });
    expect(meta(privacy, privacy.loader({ request: visit() } as Args))).toEqual({
      title: "Kebijakan privasi, Pantau Bencana BNPB",
    });
    for (const route of [draft, start, home]) expect(route.meta({ data: undefined, matches: [] } as Args)).toEqual([]);
  });

  test("the root hands the site's address to every page's links", () => {
    expect(
      root.loader({
        request: new Request("https://respon.example.test/", { headers: { cookie: "theme=dark" } }),
        context: { origin: "https://respon.example.test" },
      } as Args),
    ).toEqual({ origin: "https://respon.example.test", theme: "dark", language: "id" });
    // The language picked is the public pages' own; the desk stays Indonesian.
    for (const [path, language] of [
      ["/info", "jv"],
      ["/desk/LA-261126-01", "id"],
    ] as const)
      expect(
        root.loader({
          request: new Request(`https://respon.example.test${path}`, { headers: { cookie: "bahasa=jv" } }),
          context: { origin: "https://respon.example.test" },
        } as Args).language,
      ).toBe(language);
    expect(root.shouldRevalidate({ formAction: "/language" } as Args)).toBe(true);
    expect(root.shouldRevalidate({ formAction: "/theme" } as Args)).toBe(true);
    expect(root.shouldRevalidate({ formAction: "/report" } as Args)).toBe(false);
    expect(root.links().map((link) => (link as { href: string }).href)).toEqual([
      "/favicon-32.png",
      "/apple-touch-icon.png",
      "/manifest.webmanifest",
    ]);
  });

  test("an unknown address answers 404, is not indexed, and leads back home", async () => {
    const loaded = unwrap(notFound.loader({ request: visit() } as Args));
    expect(loaded.init?.status).toBe(404);
    expect(notFound.meta({ data: loaded.data, matches: [] } as Args)).toContainEqual({
      name: "robots",
      content: "noindex, nofollow",
    });
    renderPage(routeElement(NotFoundRoute, { loaderData: loaded.data }), { path: "/nowhere" });
    expect(await screen.findByRole("heading", { name: "Halaman tidak ditemukan" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ke halaman awal" }).getAttribute("href")).toBe("/");
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
      start_url: "/",
      display: "standalone",
    });
    expect(body.icons).toHaveLength(3);
    expect(body.shortcuts.map((one) => one.url)).toEqual(["/report", "/report?emergency=1", "/feed"]);
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
        request: new Request(`http://localhost/poster${query}`),
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
    renderPage(routeElement(PosterRoute, { loaderData: shown }), { path: "/poster" });
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
          request: new Request(`http://localhost/info${query}`),
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
    expect(await load("?regency=1108", none)).toEqual({ kind: "start", query: "" });
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
    expect(await load("?regency=11.08", json(OUTLOOK))).toEqual({ kind: "outlook", query: "", outlook: OUTLOOK });
    expect(await load("?regency=99.99", json({}, 404))).toEqual({ kind: "none", query: "" });
    expect(await load("?regency=11.08", json({}, 503))).toEqual({ kind: "unavailable", query: "" });
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
        path: "/info",
      },
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Info daerah" })).toBeTruthy();
  });

  test("a missing person: who reports first, a village search, the form, and what was sent", async () => {
    expect(missing.headers()).toEqual({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });
    expect(missing.meta({ data: { texts: pickTexts(PAGE_TEXTS.missing) }, matches: [] } as Args)[0]).toEqual({
      title: "Lapor orang hilang, Pantau Bencana BNPB",
    });
    const village = (level: string, code: string) => ({
      level,
      code,
      name: "Uji",
      districtName: level === "regency" ? null : "Baktiya",
      regencyName: "Aceh Utara",
      provinceName: "Aceh",
    });
    const found = {
      items: [
        village("district", "11.08.01"),
        village("village", "11.08.01.2001"),
        { ...village("village", "11.08.01.2002"), districtName: null },
      ],
      total: 3,
      cut: false,
      dataDate: "2026-11-01",
    };
    const load = async (query: string, answers: Record<string, () => Response>) =>
      missing.loader({
        request: new Request(`http://x/orang-hilang${query}`),
        context: { api: api(answers) },
      } as Args);
    const mine = json([]);
    expect(await load("", { "GET /missing/mine": json(apiEnvelope("auth.signInFirst"), 401) })).toMatchObject({
      kind: "whoFirst",
    });
    expect(await load("", { "GET /missing/mine": mine })).toMatchObject({ kind: "form", search: { kind: "start" } });
    expect(await load("?q=ab", { "GET /missing/mine": mine })).toMatchObject({ search: { kind: "short" } });
    expect(await load("?q=uji", { "GET /missing/mine": mine, "GET /places/search": json({}, 503) })).toMatchObject({
      search: { kind: "unavailable" },
    });
    expect(
      await load("?q=uji", { "GET /missing/mine": mine, "GET /places/search": json({ ...found, items: [] }) }),
    ).toMatchObject({ search: { kind: "none" } });
    const results = await load("?q=uji&sent=1", { "GET /missing/mine": mine, "GET /places/search": json(found) });
    expect(results).toMatchObject({
      sent: true,
      search: {
        kind: "results",
        villages: [
          { code: "11.08.01.2001", name: "Uji", districtName: "Baktiya", regencyName: "Aceh Utara" },
          { code: "11.08.01.2002", name: "Uji", districtName: "", regencyName: "Aceh Utara" },
        ],
      },
    });
    const posted = (answer: () => Response) => {
      return missing.action({
        // The photo goes on to the service and is not drawn again.
        request: {
          formData: async () => {
            const body = new FormData();
            body.set("name", "Uji");
            body.set("villageCode", "11.08.01.2001");
            body.set("photo", new File([new Uint8Array(3)], "foto.jpg"));
            return body;
          },
        },
        context: { api: api({ "POST /missing": answer }) },
      } as Args);
    };
    const done = (await posted(json({ id: "x" }, 201))) as Response;
    expect([done.status, done.headers.get("location")]).toEqual([303, "/missing?sent=1"]);
    const wrongName = {
      ...apiEnvelope("request.invalidFields"),
      fields: [{ fieldId: "name", copyKey: "fieldError.missing.name", params: {} }],
    };
    const refused = unwrap(await posted(json(wrongName, 422)));
    expect(refused.init?.status).toBe(422);
    expect(refused.data).toMatchObject({ typed: { name: "Uji", villageCode: "11.08.01.2001" } });
    renderPage(routeElement(MissingRoute, { loaderData: results, actionData: refused.data }), {
      path: "/missing",
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Lapor orang hilang" })).toBeTruthy();
    expect((screen.getByLabelText("Nama lengkap") as HTMLInputElement).value).toBe("Uji");
    cleanup();
    renderPage(routeElement(MissingRoute, { loaderData: results }), { path: "/missing" });
    expect(await screen.findByRole("heading", { name: "Laporan orang hilang terkirim" })).toBeTruthy();
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
      request: new Request("http://localhost/feed?hazard=flood"),
      context: { api: answering(json({ entries: [FEED_ENTRY] })) },
    } as Args);
    expect(read).toMatchObject({ load: { kind: "feed", feed: { entries: [FEED_ENTRY] } }, hazard: "flood" });
    await feed.loader({
      request: new Request("http://localhost/feed?hazard=other"),
      context: { api: answering(json({ entries: [] })) },
    } as Args);
    expect(asked).toEqual(["/feed?hazard=flood", "/feed"]);
    const limited = apiEnvelope("limit.address.feed", { params: { limit: 600 } });
    const refused = await feed.loader({
      request: new Request("http://localhost/feed"),
      context: { api: answering(json(limited, 429)) },
    } as Args);
    expect(refused.load).toEqual({ kind: "unavailable", envelope: limited });
    const broken = await feed.loader({
      request: new Request("http://localhost/feed"),
      context: { api: answering(() => new Response("down", { status: 503 })) },
    } as Args);
    expect(broken.load).toEqual({ kind: "unavailable", envelope: null });
    // The Peringatan view reads what is on watch instead.
    const watch = await feed.loader({
      request: new Request("http://localhost/feed?mode=peringatan"),
      context: { api: answering(json(WATCH)) },
    } as Args);
    expect(watch).toMatchObject({ mode: "watch", watch: { kind: "watch", watch: WATCH } });
    const watchDown = await feed.loader({
      request: new Request("http://localhost/feed?mode=peringatan"),
      context: { api: answering(() => new Response("down", { status: 503 })) },
    } as Args);
    expect(watchDown).toMatchObject({ watch: { kind: "unavailable", envelope: null } });
    const watchView = renderPage(routeElement(FeedRoute, { loaderData: watch }), { path: "/feed" });
    expect(await screen.findByRole("heading", { name: "Status gunung api" })).toBeTruthy();
    watchView.unmount();
    expect(feed.meta({ data: read, matches: [] } as Args)).toContainEqual({ title: "Alun-alun, Pantau Bencana BNPB" });
    renderPage(routeElement(FeedRoute, { loaderData: read }), { path: "/feed" });
    expect(await screen.findByRole("heading", { level: 1, name: "Alun-alun" })).toBeTruthy();
  });

  test("a card's page reads the card, its news and whether this phone may write; posts are answered on it", async () => {
    expect(feedCard.headers()).toEqual({ "cache-control": "private, no-store" });
    const card = FEED_ENTRY.id;
    const comments = { comments: [{ id: "0123456789abcdef", text: "Air surut", at: FEED_ENTRY.sentAt }] };
    const reading = (me: () => Response, list = json(comments)) =>
      api({ "GET /feed": json({ entries: [FEED_ENTRY] }), [`GET /feed/cards/${card}/comments`]: list, "GET /me": me });
    const args = (url: string, answers: ApiCall) =>
      ({ request: new Request(url), params: { cardId: card }, context: { api: answers } }) as Args;
    const read = await feedCard.loader(args(`http://localhost/feed/${card}?sent=1`, reading(json(SAMPLE_ME))));
    expect(read).toMatchObject({
      kind: "card",
      entry: FEED_ENTRY,
      comments: comments.comments,
      known: true,
      done: "sent",
    });
    expect(
      await feedCard.loader(args(`http://localhost/feed/${card}?reported=1`, reading(json(SAMPLE_FIELD_ERROR, 401)))),
    ).toMatchObject({ known: false, done: "reported" });
    expect(await feedCard.loader(args(`http://localhost/feed/${card}`, reading(json(SAMPLE_ME))))).toMatchObject({
      done: null,
    });
    const gone = (await feedCard.loader(
      args(`http://localhost/feed/${card}`, reading(json(SAMPLE_ME), json(SAMPLE_FIELD_ERROR, 429))),
    )) as unknown as { data: { kind: string }; init: ResponseInit };
    expect([gone.data.kind, gone.init.status]).toEqual(["gone", 404]);
    const elsewhere = (await feedCard.loader(
      args(
        `http://localhost/feed/${card}`,
        api({
          "GET /feed": json({ entries: [{ ...FEED_ENTRY, id: "ffffffffffffffff" }] }),
          [`GET /feed/cards/${card}/comments`]: json(comments),
          "GET /me": json(SAMPLE_ME),
        }),
      ),
    )) as unknown as { data: { kind: string } };
    expect(elsewhere.data.kind).toBe("gone");
    const downFeed = (await feedCard.loader(
      args(
        `http://localhost/feed/${card}`,
        api({
          "GET /feed": () => new Response("down", { status: 503 }),
          [`GET /feed/cards/${card}/comments`]: json(comments),
          "GET /me": json(SAMPLE_ME),
        }),
      ),
    )) as unknown as { data: { kind: string } };
    expect(downFeed.data.kind).toBe("gone");
    expect(feedCard.meta({ data: read, matches: [], params: { cardId: card } } as Args)).toContainEqual({
      title: "Kabar warga, Pantau Bencana BNPB",
    });

    const acting = (answers: Record<string, () => Response>, entries: [string, string][]) =>
      feedCard.action({
        request: post(`http://localhost/feed/${card}`, entries),
        params: { cardId: card },
        context: { api: api(answers) },
      } as Args);
    const sent = (await acting({ [`POST /feed/cards/${card}/comments`]: json({}, 201) }, [
      ["intent", "comment"],
      ["text", "Air surut"],
    ])) as Response;
    expect(sent.headers.get("location")).toBe(`/feed/${card}?sent=1#news`);
    const reported = (await acting({ "POST /feed/comments/0123456789abcdef/report": json({ counted: true }) }, [
      ["intent", "report"],
      ["commentId", "0123456789abcdef"],
    ])) as Response;
    expect(reported.headers.get("location")).toBe(`/feed/${card}?reported=1#news`);
    const refused = (await acting({ [`POST /feed/cards/${card}/comments`]: json(SAMPLE_FIELD_ERROR, 422) }, [
      ["intent", "comment"],
      ["text", "x"],
    ])) as unknown as { data: { typed: string }; init: ResponseInit };
    expect([refused.data.typed, refused.init.status]).toEqual(["x", 422]);
    const own = (await acting({ "POST /feed/comments/0123456789abcdef/report": json(SAMPLE_FIELD_ERROR, 400) }, [
      ["intent", "report"],
      ["commentId", "0123456789abcdef"],
    ])) as unknown as { data: { typed: string } };
    expect(own.data.typed).toBe("");
    const noId = (await acting({ "POST /feed/comments//report": json(SAMPLE_FIELD_ERROR, 404) }, [
      ["intent", "report"],
    ])) as unknown as { init: ResponseInit };
    expect(noId.init.status).toBe(404);

    const view = renderPage(routeElement(FeedCardRoute, { loaderData: read }), { path: `/feed/${card}` });
    expect(await screen.findByRole("heading", { level: 2, name: "Kabar warga" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Kabar Anda sudah tampil di bawah.");
    view.unmount();
    const answered = renderPage(routeElement(FeedCardRoute, { loaderData: read, actionData: refused.data }), {
      path: `/feed/${card}`,
    });
    expect(((await screen.findByRole("textbox")) as HTMLTextAreaElement).value).toBe("x");
    expect(screen.queryByRole("status")).toBeNull();
    answered.unmount();
    const fresh = renderPage(routeElement(FeedCardRoute, { loaderData: read }), { path: `/feed/${card}` });
    expect(await screen.findByRole("heading", { level: 2, name: "Kabar warga" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Kabar warga" })).toBeNull();
    fresh.unmount();
    renderPage(routeElement(FeedCardRoute, { loaderData: gone.data }), { path: `/feed/${card}` });
    expect(await screen.findByRole("heading", { name: "Kejadian ini sudah tidak tampil di Alun-alun" })).toBeTruthy();
  });

  test("a follow-up file is read for its reader, its forms answered on it, and a member's link posted for", async () => {
    expect(caseFile.headers()).toEqual({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });
    const FILE = CASE_VIEW.file.id;
    const args = (answers: Record<string, () => Response>, url = `http://localhost/cases/${FILE}`) =>
      ({ request: new Request(url), params: { fileId: FILE }, context: { api: api(answers) } }) as Args;
    const read = unwrap(await caseFile.loader(args({ [`GET /cases/${FILE}`]: json(CASE_VIEW) })));
    expect(read).toMatchObject({ data: { kind: "file", view: CASE_VIEW }, init: { status: 200 } });
    const signIn = unwrap(await caseFile.loader(args({ [`GET /cases/${FILE}`]: json(SAMPLE_FIELD_ERROR, 401) })));
    expect(signIn).toMatchObject({ data: { kind: "signIn" }, init: { status: 401 } });
    const refused = unwrap(await caseFile.loader(args({ [`GET /cases/${FILE}`]: json(SAMPLE_FIELD_ERROR, 404) })));
    expect(refused).toMatchObject({ data: { kind: "refused" }, init: { status: 404 } });
    expect(caseFile.meta({ data: (read as { data: unknown }).data, matches: [] } as Args)).toContainEqual({
      title: "Data lanjutan BPBD, Pantau Bencana BNPB",
    });
    const acting = (answers: Record<string, () => Response>, entries: [string, string][]) =>
      caseFile.action({
        request: post(`http://localhost/cases/${FILE}`, entries),
        params: { fileId: FILE },
        context: { api: api(answers) },
      } as Args);
    const kept = (await acting({ [`POST /cases/${FILE}/records`]: json({ recordId: "x" }) }, [
      ["intent", "record"],
      ["kind", "house"],
    ])) as Response;
    expect(kept.headers.get("location")).toBe(`/cases/${FILE}?kind=house&saved=record`);
    expect(
      await acting({ [`POST /cases/${FILE}/members`]: json({ link: "http://x/abc" }) }, [
        ["intent", "member"],
        ["name", "Uji"],
      ]),
    ).toEqual({ envelope: null, typed: null, link: { link: "http://x/abc", name: "Uji" }, revealed: null });
    expect(
      await acting({ [`POST /cases/${FILE}/records/c1/reveal`]: json({ personal: { name: "Uji" } }) }, [
        ["intent", "reveal"],
        ["recordId", "c1"],
      ]),
    ).toEqual({ envelope: null, typed: null, link: null, revealed: { recordId: "c1", personal: { name: "Uji" } } });
    const failed = unwrap(
      await acting({ [`POST /cases/${FILE}/nil`]: json(SAMPLE_FIELD_ERROR, 409) }, [["intent", "nil"]]),
    );
    expect(failed).toMatchObject({ init: { status: 409 }, data: { envelope: SAMPLE_FIELD_ERROR } });
    const view = renderPage(routeElement(CaseFileRoute, { loaderData: (read as { data: unknown }).data }), {
      path: "/cases/:fileId",
      entry: `/cases/${FILE}`,
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Data lanjutan BPBD" })).toBeTruthy();
    view.unmount();
    const out = renderPage(routeElement(CaseFileRoute, { loaderData: (signIn as { data: unknown }).data }), {
      path: "/cases/x",
    });
    expect(await screen.findByText(/Buka tautan dari petugas BPBD/)).toBeTruthy();
    out.unmount();
    const denied = renderPage(routeElement(CaseFileRoute, { loaderData: (refused as { data: unknown }).data }), {
      path: "/cases/x",
    });
    expect(await screen.findByRole("alert")).toBeTruthy();
    denied.unmount();

    expect(caseJoin.headers()).toEqual({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });
    expect(caseJoin.meta({ data: caseJoin.loader(), matches: [] } as Args)).toContainEqual({
      title: "Data lanjutan BPBD, Pantau Bencana BNPB",
    });
    const joined = (await caseJoin.action({
      params: { token: "abc" },
      context: {
        api: api({
          "POST /case-links/abc": () =>
            new Response(JSON.stringify({ fileId: FILE }), { headers: { "set-cookie": "case_access=x; Path=/" } }),
        }),
      },
    } as Args)) as Response;
    expect([joined.status, joined.headers.get("location"), joined.headers.get("set-cookie")]).toEqual([
      303,
      `/cases/${FILE}`,
      "case_access=x; Path=/",
    ]);
    const used = unwrap(
      await caseJoin.action({
        params: { token: "abc" },
        context: { api: api({ "POST /case-links/abc": json(SAMPLE_FIELD_ERROR, 404) }) },
      } as Args),
    );
    expect(used).toMatchObject({ init: { status: 404 } });
    const page = renderPage(routeElement(CaseJoinRoute, { loaderData: caseJoin.loader() }), {
      path: "/cases/join/abc",
    });
    expect(await screen.findByRole("button", { name: "Masuk" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    page.unmount();
    renderPage(
      routeElement(CaseJoinRoute, { loaderData: caseJoin.loader(), actionData: (used as { data: unknown }).data }),
      {
        path: "/cases/join/abc",
      },
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(/sudah dipakai/);
  });

  test("the today page is read on the server, a kind picked from it; shut it answers 404", async () => {
    expect(today.headers()).toEqual({ "cache-control": "private, no-store" });
    const read = await today.loader({
      request: new Request("http://localhost/today?hazard=flood"),
      context: { api: api({ "GET /today": json(TODAY) }) },
    } as Args);
    expect(read).toMatchObject({ load: { kind: "today", today: TODAY }, hazard: "flood" });
    const shut = (await today.loader({
      request: new Request("http://localhost/today?hazard=other"),
      context: { api: api({ "GET /today": json(apiEnvelope("today.closed"), 404) }) },
    } as Args)) as unknown as { data: { load: unknown; hazard: unknown }; init: ResponseInit };
    expect([shut.data.load, shut.data.hazard, shut.init.status]).toEqual([{ kind: "closed" }, null, 404]);
    const broken = await today.loader({
      request: new Request("http://localhost/today"),
      context: { api: api({ "GET /today": () => new Response("down", { status: 503 }) }) },
    } as Args);
    expect(broken).toMatchObject({ load: { kind: "unavailable", envelope: null } });
    expect(today.meta({ data: read, matches: [] } as Args)).toContainEqual({
      title: "Kejadian hari ini, Pantau Bencana BNPB",
    });
    renderPage(routeElement(TodayRoute, { loaderData: read }), { path: "/today" });
    expect(await screen.findByRole("heading", { level: 1, name: "Kejadian hari ini" })).toBeTruthy();
  });

  test("the home reads the open drafts on the server, and survives when it cannot", async () => {
    const sought = [
      { id: "m1", name: "Uji Hilang", status: "open", villageName: "Uji", createdAt: "2026-11-26T03:00:00.000Z" },
    ];
    const read = await home.loader({
      request: visit(),
      context: { api: api({ "GET /me": json(SAMPLE_ME), "GET /missing/mine": json(sought) }) },
    } as Args);
    expect(read.me).toEqual(SAMPLE_ME);
    expect(read.missing).toEqual(sought);
    const down = await home.loader({
      request: visit(),
      context: {
        api: api({ "GET /me": json(SAMPLE_FIELD_ERROR, 503), "GET /missing/mine": json(SAMPLE_FIELD_ERROR, 401) }),
      },
    } as Args);
    expect(down.me).toBeNull();
    expect(down.missing).toEqual([]);
    renderPage(routeElement(HomeRoute, { loaderData: read }), { path: "/" });
    expect(await screen.findByRole("link", { name: "Lapor kejadian" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lapor darurat" }).getAttribute("href")).toBe("/report?emergency=1");
    // One tap is no longer offered on the home page, even where a reporter is known.
    expect(screen.queryByRole("link", { name: "Darurat sekali ketuk" })).toBeNull();
    cleanup();
    renderPage(routeElement(HomeRoute, { loaderData: down }), { path: "/" });
    expect(await screen.findByRole("link", { name: "Lapor darurat" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Darurat sekali ketuk" })).toBeNull();
  });

  test("a report's own page is read on the server, private; a refused one answers with its status", async () => {
    expect(ownReport.headers()).toEqual({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });
    const params = { ticketNumber: "LA-231126-01" };
    const path = "/reports/LA-231126-01";
    const loaded = unwrap(
      await ownReport.loader({
        params,
        request: visit(),
        context: { api: api({ [`GET ${path}`]: json(OWN_REPORT) }) },
      } as Args),
    );
    expect(loaded.init?.status).toBe(200);
    expect(ownReport.meta({ data: loaded.data, matches: [] } as Args)).toContainEqual({
      title: "Laporan saya, Pantau Bencana BNPB",
    });
    renderPage(routeElement(OwnReportRoute, { loaderData: loaded.data }), { path: "/reports/LA-231126-01" });
    expect(await screen.findByRole("heading", { level: 1, name: "LA-231126-01" })).toBeTruthy();
    cleanup();

    const missing = json(apiEnvelope("report.notFound"), 404);
    const refused = unwrap(
      await ownReport.loader({ params, request: visit(), context: { api: api({ [`GET ${path}`]: missing }) } } as Args),
    );
    expect(refused.init?.status).toBe(404);
    renderPage(routeElement(OwnReportRoute, { loaderData: refused.data }), { path: "/reports/LA-231126-01" });
    expect(await screen.findByRole("heading", { level: 1, name: "Laporan tidak ditemukan" })).toBeTruthy();
  });

  test("news is started by a post that leads to its draft, or drawn with its refusal", async () => {
    const params = { ticketNumber: "LA-231126-01" };
    const path = "POST /reports/LA-231126-01/follow-ups";
    const request = (action: string) => post("http://localhost/reports/LA-231126-01", [["action", action]]);
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
    expect([started.status, started.headers.get("location")]).toEqual([303, "/report/d-9"]);
    const closed = apiEnvelope("followUp.closed", { params: { reason: "followUp.closed.tooLate" } });
    const refused = unwrap(await act(json(closed, 409)));
    expect(refused.init?.status).toBe(409);
    const loaded = unwrap(
      await ownReport.loader({
        params,
        request: visit(),
        context: { api: api({ "GET /reports/LA-231126-01": json(OWN_REPORT) }) },
      } as Args),
    );
    renderPage(routeElement(OwnReportRoute, { loaderData: loaded.data, actionData: refused.data }), {
      path: "/reports/LA-231126-01",
    });
    expect((await screen.findByRole("alert")).textContent).toContain("72 jam");
  });

  test("a draft of news that is over leads back to its report", async () => {
    const ended = SAMPLE_DRAFTS.followUpEnded;
    const answer = draft.loader({
      params: { draftId: ended.draftId },
      request: new Request(`http://localhost/report/${ended.draftId}`),
      context: { api: api({ [`GET /drafts/${ended.draftId}`]: json(ended) }) },
    } as Args);
    const thrown = (await answer.catch((response: unknown) => response)) as Response;
    expect([thrown.status, thrown.headers.get("location")]).toEqual([303, "/reports/LA-231126-01?saved=sent"]);
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
      request: post("http://localhost/desk/LA-1/documents", [
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
      request: visit(),
      context: { api: api({ "GET /emergencies/start": json(start) }) },
    } as Args);
    const titles = emergency
      .meta({ data: loaded, matches: [] } as Args)
      .map((tag) => (tag as { title?: string }).title);
    expect(titles.find(Boolean)).toMatch(/^Darurat sekali ketuk/);
    renderPage(routeElement(EmergencyRoute, { loaderData: loaded }), { path: "/emergency" });
    expect(await screen.findByRole("heading", { level: 1, name: "Darurat sekali ketuk" })).toBeTruthy();
    const stranger = await emergency.loader({
      request: visit(),
      context: { api: api({ "GET /emergencies/start": json(SAMPLE_FIELD_ERROR, 401) }) },
    } as Args);
    expect((stranger as Response).headers.get("location")).toBe("/report?emergency=1");
  });

  test("the tracking page is never cached or indexed, and reads its report with script", async () => {
    expect(tracking.headers()).toEqual({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });
    const loaded = tracking.loader({ request: visit() } as Args);
    expect(tracking.meta({ data: loaded, matches: [] } as Args)).toContainEqual({
      title: "Lacak laporan, Pantau Bencana BNPB",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(apiEnvelope("tracking.notFound"), { status: 404 })),
    );
    renderPage(routeElement(TrackingRoute, { loaderData: loaded }), { path: "/track" });
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
    const loaded = await help.loader({
      request: visit(),
      context: { api: api({ "GET /education": json(topics) }) },
    } as Args);
    renderPage(routeElement(HelpRoute, { loaderData: loaded }), { path: "/help" });
    expect(await screen.findByRole("heading", { level: 2, name: "Istilah" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Edukasi siaga" })).toBeTruthy();
    expect(screen.getByText("Siapkan tas siaga")).toBeTruthy();
    expect(screen.getByRole("link", { name: "BNPB: Buku saku" }).getAttribute("href")).toBe("https://bnpb.go.id/");
    expect(screen.getByText("Topik per 19 November 2026.")).toBeTruthy();
    cleanup();
    const without = await help.loader({
      request: visit(),
      context: { api: api({ "GET /education": json(SAMPLE_FIELD_ERROR, 503) }) },
    } as Args);
    renderPage(routeElement(HelpRoute, { loaderData: without }), { path: "/help" });
    expect(await screen.findByText(/Topik edukasi siaga belum bisa dimuat/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Baca kebijakan privasi lengkap" }).getAttribute("href")).toBe("/privacy");
    renderPage(routeElement(AboutRoute, { loaderData: about.loader({ request: visit() } as Args) }), {
      path: "/about",
    });
    expect(await screen.findByRole("link", { name: /112 Darurat terpadu/ })).toHaveProperty("href", "tel:112");
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(6);
    // Each photo of the home is credited with its author, its licence's page and its source.
    const credits = screen.getByRole("heading", { level: 2, name: "Kredit foto" }).closest("section") as HTMLElement;
    expect(within(credits).getByText("Foto: DenY Krisbiyantoro")).toBeTruthy();
    expect(within(credits).getByText("Domain publik")).toBeTruthy();
    expect(
      within(credits)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("rel")]),
    ).toEqual([
      [
        "Sumber di Wikimedia Commons",
        "https://commons.wikimedia.org/wiki/File:Seroja_2021-04-05_0545Z.jpg",
        "noopener noreferrer",
      ],
      ["CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/", "license noopener noreferrer"],
      [
        "Sumber di Wikimedia Commons",
        "https://commons.wikimedia.org/wiki/File:Rumah-rumah_warga_masih_terendam_air_paska_banjir_bandang_Gorontalo_2024.jpg",
        "noopener noreferrer",
      ],
      ["CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/", "license noopener noreferrer"],
      [
        "Sumber di Wikimedia Commons",
        "https://commons.wikimedia.org/wiki/File:Marking_the_Fire.jpg",
        "noopener noreferrer",
      ],
    ]);
    renderPage(routeElement(PrivacyRoute, { loaderData: privacy.loader({ request: visit() } as Args) }), {
      path: "/privacy",
    });
    expect(await screen.findByRole("heading", { level: 2, name: "Hak Anda" })).toBeTruthy();
    expect(screen.getByText("28 November 2026")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Tentang" })[0]?.getAttribute("href")).toBe("/about");
    expect(screen.getByRole("link", { name: "Hak Anda" }).getAttribute("href")).toBe("#privacy-rights-2");
    expect(screen.queryByText(/Yang berlaku secara hukum/)).toBeNull();
  });

  test("Nomor penting lists the national numbers, leads to the BPBD's, and BNPB's own", async () => {
    const loaded = numbers.loader({ request: visit() } as Args);
    expect(numbers.meta({ data: loaded, matches: [] } as Args)[0]).toEqual({
      title: "Nomor penting, Pantau Bencana BNPB",
    });
    renderPage(routeElement(NumbersRoute, { loaderData: loaded }), { path: "/numbers" });
    expect(await screen.findByRole("heading", { level: 1, name: "Nomor penting" })).toBeTruthy();
    const calls = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"))
      .filter((href) => href?.startsWith("tel:"));
    expect(calls).toEqual(expect.arrayContaining(["tel:112", "tel:117", "tel:115", "tel:119", "tel:110", "tel:113"]));
    expect(screen.getByRole("link", { name: "Cari di Info daerah" }).getAttribute("href")).toBe("/info");
  });

  test("a public page is in the visitor's language, and the privacy text says the Indonesian one binds", async () => {
    const english = privacy.loader({ request: visit("/privacy", "bahasa=en") } as Args);
    expect(english.texts["app.lang"]).toBe("en");
    expect(english.texts["privacy.title"]).not.toBe(
      privacy.loader({ request: visit() } as Args).texts["privacy.title"],
    );
    renderPage(routeElement(PrivacyRoute, { loaderData: english }), { path: "/privacy" });
    expect(await screen.findByText(english.texts["privacy.translationNote"] as string)).toBeTruthy();
    const home = await homeLoaderIn("bahasa=jv");
    expect(home.texts["app.lang"]).toBe("jv");
  });

  test("the start step loads, posts, redirects with a 303, or draws the refusal", async () => {
    const context = {
      api: api({
        "GET /me": json(SAMPLE_ME),
        "POST /consent": () =>
          Response.json({ draftId: DRAFT }, { status: 201, headers: { "set-cookie": "device_key=x" } }),
      }),
    };
    const loaded = await start.loader({ request: new Request("http://x/report"), context } as Args);
    expect(loaded.view).toBe("list");
    const moved = (await start.action({
      request: post("http://x/report?village=1108012005", [
        ["action", "consent"],
        ["role", "citizen"],
        ["name", "Uji"],
        ["number", "080000000001"],
      ]),
      context,
    } as Args)) as Response;
    expect(moved.status).toBe(303);
    expect(moved.headers.get("location")).toBe(`/report/${DRAFT}`);
    expect(moved.headers.get("set-cookie")).toBe("device_key=x");
    // Who reports is said on the way to a missing person's report, which is where it leads back.
    const back = (await start.action({
      request: post("http://x/report?missing=1", [
        ["action", "consent"],
        ["role", "citizen"],
        ["name", "Uji"],
        ["number", "080000000001"],
      ]),
      context,
    } as Args)) as Response;
    expect([back.status, back.headers.get("location")]).toEqual([303, "/missing"]);
    const drawn = unwrap(
      await start.action({ request: post("http://x/report", [["action", "decline"]]), context } as Args),
    );
    expect(drawn.data).toMatchObject({ view: "declineConfirm" });
    renderPage(routeElement(StartRoute, { loaderData: loaded, actionData: undefined }), { path: "/report" });
    expect(await screen.findByRole("heading", { name: "Pilih pelapor" })).toBeTruthy();
    cleanup();
    // "Lapor darurat" opens the same page, saying the way is short, with 112 at hand.
    const alarmed = await start.loader({
      request: new Request("http://x/report?emergency=1"),
      context,
    } as Args);
    renderPage(routeElement(StartRoute, { loaderData: alarmed, actionData: undefined }), {
      path: "/report",
      entry: "/report?emergency=1",
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
        request: new Request(`http://x/report/${DRAFT}`),
        context,
      } as Args),
    );
    expect(loaded.data).toMatchObject({ kind: "draft", searching: false });
    const sent = (await draft.action({
      params: { draftId: DRAFT },
      request: post(`http://x/report/${DRAFT}`, [["action", "send"]]),
      context,
    } as Args)) as Response;
    expect([sent.status, sent.headers.get("X-Remix-Replace")]).toEqual([303, "true"]);
    const refused = unwrap(
      await draft.action({
        params: { draftId: DRAFT },
        request: post(`http://x/report/${DRAFT}`, [["dead", "x"]]),
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
        request: new Request(`http://x/report/${DRAFT}`),
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
          request: new Request("http://x/desk?view=list"),
          context: { api: api({ "GET /desk/reports": answer, "GET /desk/summary": json(SUMMARY) }) },
        } as Args),
      );
    const queue = await load(json(QUEUE));
    expect(queue.init?.status).toBe(200);
    renderPage(routeElement(DeskRoute, { loaderData: queue.data, actionData: undefined }), { path: "/desk" });
    expect(await screen.findAllByText("Masuk sebagai Pusdalops BNPB, Petugas Uji")).toHaveLength(2);
    cleanup();
    const signIn = await load(json(signInFirst, 401));
    renderPage(routeElement(DeskRoute, { loaderData: signIn.data, actionData: undefined }), { path: "/desk" });
    expect(await screen.findByRole("heading", { name: "Masuk meja laporan" })).toBeTruthy();
    cleanup();
    const refused = await load(json(notAllowed, 403));
    expect(refused.init?.status).toBe(403);
    renderPage(routeElement(DeskRoute, { loaderData: refused.data, actionData: undefined }), { path: "/desk" });
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
          request: new Request("http://x/desk/response?month=2026-11"),
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
      renderPage(routeElement(DeskResponseRoute, { loaderData }), { path: "/desk/response" });
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
    expect([barred.status, barred.headers.get("location")]).toEqual([303, "/desk/response?refused=aggregates"]);
    const pause = async (answer: () => Response, url: string) => {
      const body = new FormData();
      body.set("paused", "1");
      const done = (await deskResponse.action({
        request: new Request(url, { method: "POST", body }),
        context: { api: api({ "POST /desk/warnings": answer }) },
      } as Args)) as Response;
      return [done.status, done.headers.get("location")];
    };
    expect(await pause(json({}), "http://x/desk/response?month=2026-10&refused=warnings")).toEqual([
      303,
      "/desk/response?month=2026-10",
    ]);
    expect(await pause(json(notAllowed, 403), "http://x/desk/response")).toEqual([
      303,
      "/desk/response?refused=warnings",
    ]);
  });

  test("missing persons: the list by status, the sign-in form, a refusal, and a move", async () => {
    expect(deskMissing.headers()).toEqual({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });
    expect(deskMissing.meta({ data: { texts: pickTexts(PAGE_TEXTS.desk) }, matches: [] } as Args)[0]).toEqual({
      title: "Meja laporan, Pantau Bencana BNPB",
    });
    const asked: string[] = [];
    const load = async (url: string, answer: () => Response) =>
      unwrap(
        await deskMissing.loader({
          request: new Request(url),
          context: {
            api: async (_method: string, path: string) => {
              asked.push(path);
              return path === "/desk/summary" ? json(SUMMARY)() : answer();
            },
          },
        } as Args),
      );
    const show = (loaderData: unknown, actionData?: unknown) =>
      renderPage(routeElement(DeskMissingRoute, { loaderData, actionData }), { path: "/desk/missing" });
    const listed = await load("http://x/desk/missing?status=toSar&saved=1", json({ items: [] }));
    expect(listed.data).toMatchObject({ kind: "missing", status: "toSar", saved: true, items: [] });
    expect((await load("http://x/desk/missing?status=gone", json({ items: [] }))).data).toMatchObject({
      status: null,
      saved: false,
    });
    expect(asked.filter((path) => path !== "/desk/summary")).toEqual(["/desk/missing?status=toSar", "/desk/missing"]);
    show(listed.data);
    expect(await screen.findByRole("heading", { level: 1, name: "Orang dicari" })).toBeTruthy();
    cleanup();
    show((await load("http://x/desk/missing", json(signInFirst, 401))).data);
    expect(await screen.findByRole("heading", { name: "Masuk meja laporan" })).toBeTruthy();
    cleanup();
    const refused = await load("http://x/desk/missing", json(notAllowed, 403));
    expect(refused.init?.status).toBe(403);
    show(refused.data);
    expect(await screen.findByRole("heading", { name: "Meja laporan belum bisa dibuka" })).toBeTruthy();
    cleanup();
    const sent: unknown[] = [];
    const moved = (url: string, answer: () => Response) =>
      deskMissing.action({
        request: post(url, [
          ["id", "abc"],
          ["to", "foundSafe"],
          ["note", "Di posko"],
        ]),
        context: {
          api: async (_method: string, path: string, body: unknown) => {
            sent.push([path, body]);
            return answer();
          },
        },
      } as Args);
    const done = (await moved("http://x/desk/missing?status=open", json({}))) as Response;
    expect([done.status, done.headers.get("location")]).toEqual([303, "/desk/missing?status=open&saved=1#orang-abc"]);
    const plain = (await moved("http://x/desk/missing", json({}))) as Response;
    expect(plain.headers.get("location")).toBe("/desk/missing?saved=1#orang-abc");
    expect(sent[0]).toEqual(["/desk/missing/abc/status", { to: "foundSafe", note: "Di posko" }]);
    const again = unwrap(await moved("http://x/desk/missing", json(notAllowed, 409)));
    expect(again.init?.status).toBe(409);
    show(listed.data, again.data);
    expect(await screen.findByText(/^Akun ini belum berhak/)).toBeTruthy();
  });

  test("numbers: either list by the address, the sign-in form, a refusal, and each edit sent and led back", async () => {
    expect(deskNumbers.headers()).toEqual({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });
    expect(deskNumbers.meta({ data: { texts: pickTexts(PAGE_TEXTS.desk) }, matches: [] } as Args)[0]).toEqual({
      title: "Meja laporan, Pantau Bencana BNPB",
    });
    const list = { checksum: "abc", total: 0, page: 1, pages: 1, changes: [] };
    const asked: string[] = [];
    const load = async (url: string, answer: () => Response) =>
      unwrap(
        await deskNumbers.loader({
          request: new Request(url),
          context: {
            api: async (_method: string, path: string) => {
              asked.push(path);
              return path === "/desk/summary" ? json(SUMMARY)() : answer();
            },
          },
        } as Args),
      );
    const show = (loaderData: unknown, actionData?: unknown) =>
      renderPage(routeElement(DeskNumbersRoute, { loaderData, actionData }), { path: "/desk/numbers" });
    const areas = await load("http://x/desk/numbers?q=aceh&empty=1&page=2&saved=changed", json({ ...list, areas: [] }));
    expect(areas.data).toMatchObject({
      kind: "numbers",
      saved: "changed",
      view: { tab: "bpbd", search: { q: "aceh", empty: true } },
    });
    const places = await load(
      `http://x/desk/numbers?tab=facilities&kind=polisi&page=x&saved=gone&q=${"a".repeat(70)}`,
      json({ ...list, facilities: [] }),
    );
    expect(places.data).toMatchObject({ saved: null, view: { tab: "facilities", search: { kind: "polisi" } } });
    await load("http://x/desk/numbers?tab=facilities&kind=klinik&page=-3", json({ ...list, facilities: [] }));
    expect(asked.filter((path) => path !== "/desk/summary")).toEqual([
      "/desk/numbers/bpbd?q=aceh&page=2&empty=1",
      `/desk/numbers/facilities?q=${"a".repeat(60)}&page=1&kind=polisi`,
      "/desk/numbers/facilities?q=&page=1",
    ]);
    show(areas.data);
    expect(await screen.findByRole("heading", { level: 1, name: "Nomor BPBD dan fasilitas" })).toBeTruthy();
    cleanup();
    show((await load("http://x/desk/numbers", json(signInFirst, 401))).data);
    expect(await screen.findByRole("heading", { name: "Masuk meja laporan" })).toBeTruthy();
    cleanup();
    const refused = await load("http://x/desk/numbers", json(notAllowed, 403));
    expect(refused.init?.status).toBe(403);
    show(refused.data);
    expect(await screen.findByRole("heading", { name: "Meja laporan belum bisa dibuka" })).toBeTruthy();
    cleanup();
    const sent: unknown[] = [];
    const act = (url: string, entries: [string, string][], answer: () => Response = json({ checksum: "new" })) =>
      deskNumbers.action({
        request: post(url, entries),
        context: {
          api: async (_method: string, path: string, body: unknown) => {
            sent.push([path, body]);
            return answer();
          },
        },
      } as Args);
    const at = async (done: unknown) => {
      const response = done as Response;
      return [response.status, response.headers.get("location")];
    };
    const number: [string, string][] = [
      ["nomor", "0811 2222 3333"],
      ["jenis", "wa"],
      ["url", ""],
    ];
    expect(
      await at(
        await act("http://x/desk/numbers?q=aceh&empty=1&page=2", [
          ["tab", "bpbd"],
          ["edit", "change"],
          ["checksum", "abc"],
          ["code", "1108"],
          ["index", "1"],
          ["lama", "on"],
          ...number,
        ]),
      ),
    ).toEqual([303, "/desk/numbers?q=aceh&empty=1&page=2&saved=changed#wilayah-1108"]);
    expect(
      await at(
        await act("http://x/desk/numbers", [
          ["tab", "bpbd"],
          ["edit", "add"],
          ["checksum", ""],
          ["code", "11"],
          ...number,
        ]),
      ),
    ).toEqual([303, "/desk/numbers?saved=added#wilayah-11"]);
    expect(
      await at(
        await act("http://x/desk/numbers?tab=facilities&kind=rs", [
          ["tab", "facilities"],
          ["edit", "add"],
          ["checksum", "abc"],
          ["kind", "rs"],
          ["name", " RSUD Uji "],
          ["phone", "0651 22222"],
          ["lat", "4,1"],
          ["lon", "96.1"],
        ]),
      ),
    ).toEqual([303, "/desk/numbers?tab=facilities&q=RSUD+Uji&saved=added"]);
    expect(
      await at(
        await act("http://x/desk/numbers?tab=facilities&kind=rs&page=3", [
          ["tab", "facilities"],
          ["edit", "remove"],
          ["checksum", "abc"],
          ["index", "7"],
        ]),
      ),
    ).toEqual([303, "/desk/numbers?tab=facilities&kind=rs&page=3&saved=removed"]);
    expect(sent).toEqual([
      [
        "/desk/numbers/bpbd",
        {
          checksum: "abc",
          edit: {
            kind: "change",
            code: "1108",
            index: 1,
            number: { nomor: "0811 2222 3333", jenis: "wa", url: "", lama: true },
          },
        },
      ],
      [
        "/desk/numbers/bpbd",
        {
          checksum: null,
          edit: { kind: "add", code: "11", number: { nomor: "0811 2222 3333", jenis: "wa", url: "", lama: false } },
        },
      ],
      [
        "/desk/numbers/facilities",
        {
          checksum: "abc",
          edit: {
            kind: "add",
            facility: { kind: "rs", name: " RSUD Uji ", phone: "0651 22222", lat: "4,1", lon: "96.1" },
          },
        },
      ],
      ["/desk/numbers/facilities", { checksum: "abc", edit: { kind: "remove", index: 7 } }],
    ]);
    const again = unwrap(
      await act(
        "http://x/desk/numbers",
        [["tab", "bpbd"], ["form", "add-11"], ["edit", "add"], ["code", "11"], ...number],
        json(apiEnvelope("numbers.changed"), 409),
      ),
    );
    expect(again.init?.status).toBe(409);
    expect(again.data).toMatchObject({ typed: { values: { form: "add-11", nomor: "0811 2222 3333" } } });
    show(areas.data, again.data);
    expect(await screen.findByText(/^Data nomor sudah diubah petugas lain/)).toBeTruthy();
  });

  test("signing in redirects with the cookie; a refused code renders with its status", async () => {
    const signed = await desk.action({
      request: post("http://x/desk", [["code", "abc"]]),
      context: {
        api: api({ "POST /desk/session": () => new Response(null, { status: 204, headers: { "set-cookie": "s=1" } }) }),
      },
    } as Args);
    expect((signed as Response).status).toBe(303);
    expect((signed as Response).headers.get("set-cookie")).toBe("s=1");
    const refused = unwrap(
      await desk.action({
        request: post("http://x/desk", [["code", "x"]]),
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
      officers: null,
      today: null,
      comments: null,
      caseFile: null,
      nextStatuses: [],
      revision: 0,
      mayTake: false,
      point: null,
      revisable: [],
      offeredActions: [],
      actions: [],
      proofs: [],
      replies: [],
      versions: [],
      impact: { dead: null, missing: null, injured: null, displaced: null, houses: null },
      assignment: { area: "11.08", name: "Aceh Utara", held: false },
      triage: { tier: "sedang", score: 50, reasons: ["searched", "modelLikely"] },
    };
    const load = async (answer: () => Response) =>
      unwrap(
        await deskReport.loader({
          params: { ticketNumber: "LA-241126-01" },
          context: {
            api: api({
              "GET /desk/reports/LA-241126-01": answer,
              "GET /desk/summary": json(SUMMARY),
              "GET /desk/areas": json({ areas: [] }),
            }),
          },
        } as Args),
      );
    const read = await load(json(REPORT));
    renderPage(routeElement(DeskReportRoute, { loaderData: read.data, actionData: undefined }), {
      path: "/desk/x",
    });
    expect(await screen.findByRole("heading", { name: "LA-241126-01" })).toBeTruthy();
    cleanup();
    const signIn = await load(json(signInFirst, 401));
    renderPage(routeElement(DeskReportRoute, { loaderData: signIn.data, actionData: undefined }), {
      path: "/desk/x",
    });
    expect(await screen.findByRole("heading", { name: "Masuk meja laporan" })).toBeTruthy();
    cleanup();
    const refused = await load(json(notAllowed, 404));
    expect(refused.init?.status).toBe(404);
    renderPage(routeElement(DeskReportRoute, { loaderData: refused.data, actionData: undefined }), {
      path: "/desk/x",
    });
    expect(await screen.findByRole("heading", { name: "Meja laporan belum bisa dibuka" })).toBeTruthy();
    cleanup();
    const missing = await load(
      json({ ...notAllowed, error: { ...notAllowed.error, code: "desk.reportNotFound" } }, 404),
    );
    renderPage(routeElement(DeskReportRoute, { loaderData: missing.data, actionData: undefined }), {
      path: "/desk/x",
    });
    expect(await screen.findByRole("heading", { name: "Laporan tidak ditemukan" })).toBeTruthy();
    cleanup();
    // A refused open shows above the report it was for.
    renderPage(
      routeElement(DeskReportRoute, {
        loaderData: read.data,
        actionData: { envelope: notAllowed, typed: null, identity: null, officer: null, trackingLink: null },
      }),
      {
        path: "/desk/LA-241126-01",
      },
    );
    expect((await screen.findByRole("alert")).textContent).toContain("belum berhak");
    const viewed = await deskReport.action({
      params: { ticketNumber: "LA-241126-01" },
      request: post("http://x/desk/LA-241126-01", []),
      context: { api: api({ "POST /desk/reports/LA-241126-01/view": json(REPORT) }) },
    } as Args);
    expect((viewed as Response).headers.get("location")).toBe("/desk/LA-241126-01");
    const opened = await deskReport.action({
      params: { ticketNumber: "LA-241126-01" },
      request: post("http://x/desk/LA-241126-01", [["action", "opened"]]),
      context: { api: api({ "POST /desk/reports/LA-241126-01/view": json(REPORT) }) },
    } as Args);
    expect(opened).toBeNull();
    const who = { name: "Uji Satu", number: "+6280000000001", officerRegency: null, officerPosition: null };
    const asked = unwrap(
      await deskReport.action({
        params: { ticketNumber: "LA-241126-01" },
        request: post("http://x/desk/LA-241126-01", [["action", "identity"]]),
        context: { api: api({ "POST /desk/reports/LA-241126-01/identity": json(who) }) },
      } as Args),
    );
    expect(asked.data).toEqual({ envelope: null, typed: null, identity: who, officer: null, trackingLink: null });
    const number = { profileId: "profile-a", number: "+628001108001" };
    const opened2 = unwrap(
      await deskReport.action({
        params: { ticketNumber: "LA-241126-01" },
        request: post("http://x/desk/LA-241126-01", [
          ["action", "officerNumber"],
          ["profileId", "profile-a"],
        ]),
        context: { api: api({ "POST /desk/reports/LA-241126-01/officers/profile-a/number": json(number) }) },
      } as Args),
    );
    expect(opened2.data).toEqual({ envelope: null, typed: null, identity: null, officer: number, trackingLink: null });
    const link = "https://respon.example/track#t=00112233445566778899aabbccddeeff";
    const given = unwrap(
      await deskReport.action({
        params: { ticketNumber: "LA-241126-01" },
        request: post("http://x/desk/LA-241126-01", [["action", "trackingLink"]]),
        context: { api: api({ "POST /desk/reports/LA-241126-01/tracking-link": json({ link }) }) },
      } as Args),
    );
    expect(given.data).toEqual({ envelope: null, typed: null, identity: null, officer: null, trackingLink: link });
    const limited = unwrap(
      await deskReport.action({
        params: { ticketNumber: "LA-241126-01" },
        request: post("http://x/desk/LA-241126-01", []),
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
      request: post("http://x/theme", [
        ["theme", "dark"],
        ["back", "/desk?view=map"],
      ]),
      context: { api: answer },
    } as Args)) as Response;
    expect(calls).toEqual([["/preferences/theme", { theme: "dark" }]]);
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe("/desk?view=map");
    expect(done.headers.get("set-cookie")).toBe("theme=dark; Path=/");
    const away = (await theme.action({
      request: post("http://x/theme", [
        ["theme", "dark"],
        ["back", "https://evil.example"],
      ]),
      context: { api: answer },
    } as Args)) as Response;
    expect(away.headers.get("location")).toBe("/");
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
      request: post("http://x/language", [
        ["language", "ace"],
        ["back", "/report?village=1108012005"],
      ]),
      context: { api: answer },
    } as Args)) as Response;
    expect(calls).toEqual([["/preferences/language", { language: "ace" }]]);
    expect([done.status, done.headers.get("location"), done.headers.get("set-cookie")]).toEqual([
      303,
      "/report?village=1108012005",
      "bahasa=ace; Path=/",
    ]);
  });

  test("with no script, the chooser is a page of its own that goes back where it came from", async () => {
    expect(language.headers()).toEqual({ "cache-control": "private, no-store", "x-robots-tag": "noindex" });
    expect(language.meta({ data: { texts: pickTexts(PAGE_TEXTS.language) }, matches: [] } as Args)[0]).toEqual({
      title: "Pilih bahasa, Pantau Bencana BNPB",
    });
    const loaded = language.loader({
      request: new Request("http://x/language?back=%2Freport%3Fvillage%3D1"),
    } as Args);
    expect(loaded.back).toBe("/report?village=1");
    expect(language.loader({ request: new Request("http://x/language?back=https://x.test") } as Args).back).toBe("/");
    renderPage(routeElement(LanguageRoute, { loaderData: loaded }), { path: "/language" });
    expect(await screen.findByRole("heading", { name: "Pilih bahasa Anda" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tutup" }).getAttribute("href")).toBe("/report?village=1");
  });
});
