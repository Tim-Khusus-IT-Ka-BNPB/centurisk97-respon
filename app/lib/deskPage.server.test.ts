import { describe, expect, test } from "vitest";
import type { ApiCall } from "../../src/api/bridge";
import { envelope } from "../../src/api/envelope";
import {
  actOnDesk,
  actOnDeskPilot,
  actOnDeskReport,
  filtersOf,
  loadDeskPilot,
  loadDeskQueue,
  loadDeskReport,
  loadDeskResponse,
  pauseWarnings,
  queueQuery,
} from "./deskPage.server";
import { PAGE_TEXTS, pickTexts } from "./texts.server";

type Call = { method: string; path: string; body: unknown };

function fakeApi(answer: (method: string, path: string) => Response) {
  const calls: Call[] = [];
  const api: ApiCall = async (method, path, body) => {
    calls.push({ method, path, body });
    return answer(method, path);
  };
  return { api, calls };
}

const QUEUE = { account: { label: "Petugas" }, items: [], total: 0, page: 1, pageCount: 0 };

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.append(name, value);
  return data;
};

describe("the desk queue page", () => {
  test("filters travel from the address to the API, empty ones left out", async () => {
    const { api, calls } = fakeApi(() => Response.json(QUEUE));
    const load = await loadDeskQueue(
      new URL("http://x/lapor/meja?view=list&status=seen&hazardType=&ticket=LA-1&has=victims&page=2"),
      api,
    );
    expect(calls[1]?.path).toBe("/desk/reports?status=seen&period=all&ticket=LA-1&has=victims&page=2");
    expect(load).toMatchObject({
      kind: "queue",
      shown: { view: "list", queue: QUEUE },
      envelope: null,
      filters: { view: "list", status: "seen", page: 2 },
    });
    expect(queueQuery(filtersOf(new URLSearchParams("")))).toBe("?period=all");
    expect(filtersOf(new URLSearchParams("page=0")).page).toBe(1);
    expect(filtersOf(new URLSearchParams("page=x")).page).toBe(1);
    expect(queueQuery({ view: "map", status: "", hazardType: "", period: "", ticket: "", has: "", page: 1 })).toBe("");
  });

  test("a refused search keeps the filters and says why; no staff account asks to sign in; others refuse", async () => {
    const field = envelope("request.invalidFields");
    const searched = await loadDeskQueue(
      new URL("http://x/lapor/meja?ticket=1"),
      fakeApi(() => Response.json(field, { status: 422 })).api,
    );
    expect(searched).toMatchObject({ kind: "queue", shown: null, envelope: field, summary: null });
    // The menu's counts and the alarm are read again without the search.
    const summary = { total: 3 };
    const counted = await loadDeskQueue(
      new URL("http://x/lapor/meja?ticket=1&status=new"),
      fakeApi((_method, path) =>
        path === "/desk/summary?status=new&period=all" ? Response.json(summary) : Response.json(field, { status: 422 }),
      ).api,
    );
    expect(counted).toMatchObject({ shown: null, envelope: field, summary });
    const signIn = await loadDeskQueue(
      new URL("http://x/lapor/meja"),
      fakeApi(() => Response.json(envelope("auth.staffSignInFirst"), { status: 401 })).api,
    );
    expect(signIn).toMatchObject({ kind: "signIn", envelope: null });
    const refused = await loadDeskQueue(
      new URL("http://x/lapor/meja"),
      fakeApi(() => Response.json(envelope("desk.notAllowed"), { status: 403 })).api,
    );
    expect(refused).toMatchObject({ kind: "refused", status: 403, envelope: { error: { code: "desk.notAllowed" } } });
  });
});

describe("the map and the gallery", () => {
  test("each view reads its own route with the filters and no page; an unknown view is the map", async () => {
    const { api, calls } = fakeApi(() =>
      Response.json({ account: { label: "Petugas" }, points: [], photos: [], cut: false }),
    );
    const map = await loadDeskQueue(new URL("http://x/lapor/meja?view=map&status=new&page=3"), api);
    expect(map).toMatchObject({ kind: "queue", shown: { view: "map", map: { points: [] } } });
    const gallery = await loadDeskQueue(new URL("http://x/lapor/meja?view=gallery"), api);
    expect(gallery).toMatchObject({ kind: "queue", shown: { view: "gallery", gallery: { photos: [] } } });
    await loadDeskQueue(new URL("http://x/lapor/meja?view=nope"), api);
    // Each view reads its route and the side menu's counts under the same filters.
    expect(calls.map((call) => call.path)).toEqual([
      "/desk/summary?status=new&period=all",
      "/desk/map?status=new&period=all",
      "/desk/reports?status=new&period=all",
      "/desk/summary?period=all",
      "/desk/photos?period=all",
      "/desk/summary?period=all",
      "/desk/map?period=all",
      "/desk/reports?period=all",
    ]);
  });
});

describe("the side menu's counts", () => {
  test("come with the page when they can be read, and are left out when they cannot", async () => {
    const SUMMARY = { account: { label: "Petugas" }, total: 1, byStatus: {}, byHazard: {} };
    const read = fakeApi((_method, path) =>
      path.startsWith("/desk/summary") ? Response.json(SUMMARY) : Response.json({ items: [] }),
    );
    expect(await loadDeskQueue(new URL("http://x/lapor/meja"), read.api)).toMatchObject({ summary: SUMMARY });
    const limited = fakeApi((_method, path) =>
      path.startsWith("/desk/summary")
        ? Response.json(envelope("limit.desk.read"), { status: 429 })
        : Response.json({ ticketNumber: "LA-1" }),
    );
    expect(await loadDeskReport("LA-1", limited.api)).toMatchObject({ kind: "report", summary: null });
  });
});

describe("a report on the desk", () => {
  test("is read by its ticket number, and an open is posted then shown again", async () => {
    const { api, calls } = fakeApi((method) =>
      method === "GET" ? Response.json({ ticketNumber: "LA-241126-01" }) : Response.json({}, { status: 200 }),
    );
    expect(await loadDeskReport("LA-241126-01", api)).toMatchObject({
      kind: "report",
      report: { ticketNumber: "LA-241126-01" },
    });
    expect(await actOnDeskReport("LA-241126-01", new FormData(), api)).toMatchObject({
      kind: "redirect",
      location: "/lapor/meja/LA-241126-01",
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /desk/reports/LA-241126-01",
      "GET /desk/summary",
      "POST /desk/reports/LA-241126-01/view",
    ]);
    const refused = await actOnDeskReport(
      "LA-241126-01",
      new FormData(),
      fakeApi(() => Response.json(envelope("desk.notAllowed"), { status: 403 })).api,
    );
    expect(refused).toMatchObject({ kind: "render", status: 403 });
    const missing = await loadDeskReport(
      "LA-1",
      fakeApi(() => Response.json(envelope("desk.reportNotFound"), { status: 404 })).api,
    );
    expect(missing).toMatchObject({ kind: "refused", status: 404 });
  });
});

describe("a change to a ticket", () => {
  test("a move and a reply are each posted to their route and named on the page after", async () => {
    const { api, calls } = fakeApi(() => Response.json({}));
    const moved = await actOnDeskReport(
      "LA-241126-01",
      form({ action: "status", to: "under_review", note: "Dicek", revision: "3" }),
      api,
    );
    expect(moved).toMatchObject({ kind: "redirect", location: "/lapor/meja/LA-241126-01?saved=status" });
    const replied = await actOnDeskReport("LA-241126-01", form({ action: "reply", reply: "Kami cek" }), api);
    expect(replied).toMatchObject({ kind: "redirect", location: "/lapor/meja/LA-241126-01?saved=replies" });
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/desk/reports/LA-241126-01/status",
        body: { to: "under_review", note: "Dicek", revision: 3, actions: [], otherAction: "" },
      },
      { method: "POST", path: "/desk/reports/LA-241126-01/replies", body: { text: "Kami cek" } },
    ]);
  });

  test("a photo of the work is shown on the Alun-alun or taken off, and named on the page after", async () => {
    const { api, calls } = fakeApi(() => Response.json({}));
    const shown = await actOnDeskReport(
      "LA-241126-01",
      form({ action: "proofPublic", proofId: "p1", public: "1" }),
      api,
    );
    expect(shown).toMatchObject({ location: "/lapor/meja/LA-241126-01?saved=proofShown" });
    const hidden = await actOnDeskReport(
      "LA-241126-01",
      form({ action: "proofPublic", proofId: "p1", public: "0" }),
      api,
    );
    expect(hidden).toMatchObject({ location: "/lapor/meja/LA-241126-01?saved=proofHidden" });
    expect(calls.map((call) => [call.path, call.body])).toEqual([
      ["/desk/reports/LA-241126-01/proofs/p1/public", { public: true }],
      ["/desk/reports/LA-241126-01/proofs/p1/public", { public: false }],
    ]);
  });

  test("a report taken out of its event is posted to its route and named on the page after", async () => {
    const { api, calls } = fakeApi(() => Response.json({}));
    const done = await actOnDeskReport("LA-241126-01", form({ action: "release" }), api);
    expect(done).toMatchObject({ location: "/lapor/meja/LA-241126-01?saved=released" });
    expect(calls.map((call) => call.path)).toEqual(["/desk/reports/LA-241126-01/event/release"]);
  });

  test("a check sends its figures by field, and what was done its boxes", async () => {
    const { api, calls } = fakeApi(() => Response.json({}));
    const checked = await actOnDeskReport(
      "LA-241126-01",
      form({
        action: "check",
        result: "partly",
        checkNote: "Dicek",
        "box.dead": "2",
        "box.injured": "",
        revision: "4",
      }),
      api,
    );
    expect(checked).toMatchObject({ location: "/lapor/meja/LA-241126-01?saved=checks" });
    const done = form({ action: "actions", otherAction: "Sedot sumur" });
    done.append("actions", "evakuasi");
    done.append("actions", "logistik");
    expect(await actOnDeskReport("LA-241126-01", done, api)).toMatchObject({
      location: "/lapor/meja/LA-241126-01?saved=actions",
    });
    expect(calls.map((call) => [call.path, call.body])).toEqual([
      [
        "/desk/reports/LA-241126-01/checks",
        { result: "partly", note: "Dicek", boxes: { dead: "2", injured: "" }, revision: 4 },
      ],
      ["/desk/reports/LA-241126-01/actions", { actions: ["evakuasi", "logistik"], otherAction: "Sedot sumur" }],
    ]);
  });

  test("a photo of the work goes on as a form with only its own boxes, and comes back with none when refused", async () => {
    const photo = new File(["x"], "a.jpg", { type: "image/jpeg" });
    const proof = form({ action: "proof", lat: "5.1", lon: "97", extra: "x" });
    proof.set("photo", photo);
    const kept = fakeApi(() => Response.json({}));
    expect(await actOnDeskReport("LA-241126-01", proof, kept.api)).toMatchObject({
      location: "/lapor/meja/LA-241126-01?saved=proofs",
    });
    const sent = kept.calls[0]?.body as FormData;
    expect([...sent.keys()].sort()).toEqual(["lat", "lon", "photo"]);
    const refused = await actOnDeskReport(
      "LA-241126-01",
      proof,
      fakeApi(() => Response.json(envelope("request.invalidFields"), { status: 422 })).api,
    );
    expect(refused).toMatchObject({ typed: { values: { action: "proof", lat: "5.1" }, actions: [] } });
    expect((refused as { typed: { values: object } }).typed.values).not.toHaveProperty("photo");
  });

  test("asking who reported answers on the page, with nothing in the address", async () => {
    const who = { name: "Uji Satu", number: "+6280000000001", officerRegency: null, officerPosition: null };
    const { api, calls } = fakeApi(() => Response.json(who));
    expect(await actOnDeskReport("LA-241126-01", form({ action: "identity" }), api)).toEqual({
      kind: "identity",
      identity: who,
    });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/desk/reports/LA-241126-01/identity" });
  });

  test("a refused one gives back what was typed", async () => {
    const refused = await actOnDeskReport(
      "LA-241126-01",
      form({ action: "status", to: "invalid", note: "dup", revision: "3" }),
      fakeApi(() => Response.json(envelope("request.invalidFields"), { status: 422 })).api,
    );
    expect(refused).toMatchObject({
      kind: "render",
      status: 422,
      typed: { values: { action: "status", to: "invalid", note: "dup", revision: "3" }, actions: [] },
    });
  });
});

describe("taking a report and the response figures", () => {
  test("taking is posted to its route and named on the page after", async () => {
    const { api, calls } = fakeApi(() => Response.json({}));
    expect(await actOnDeskReport("LA-241126-01", form({ action: "take" }), api)).toMatchObject({
      location: "/lapor/meja/LA-241126-01?saved=take",
    });
    expect(calls[0]?.path).toBe("/desk/reports/LA-241126-01/take");
  });

  test("the figures are read for the month asked, or this one, with the menu's counts", async () => {
    const control = { open: true, paused: false, by: null, at: null, phones: 0 };
    const { api, calls } = fakeApi((_method, path) =>
      Response.json(path === "/desk/warnings" ? control : { month: "2026-11", agencies: [] }),
    );
    expect(await loadDeskResponse("2026-10", api)).toMatchObject({
      kind: "response",
      response: { agencies: [] },
      warnings: control,
    });
    await loadDeskResponse(null, api);
    expect(calls.map((call) => call.path)).toEqual([
      "/desk/response?month=2026-10",
      "/desk/summary",
      "/desk/warnings",
      "/desk/response",
      "/desk/summary",
      "/desk/warnings",
    ]);
    const noWarnings = fakeApi((_method, path) =>
      path === "/desk/warnings"
        ? Response.json(envelope("desk.notAllowed"), { status: 403 })
        : Response.json({ month: "2026-11", agencies: [] }),
    );
    expect(await loadDeskResponse(null, noWarnings.api)).toMatchObject({ kind: "response", warnings: null });
    const refused = fakeApi(() => Response.json(envelope("desk.notAllowed"), { status: 403 }));
    expect(await loadDeskResponse(null, refused.api)).toMatchObject({ kind: "refused", status: 403 });
  });
});

describe("pausing the warnings", () => {
  test("the pause and the resume are posted as a flag, and a refusal is told", async () => {
    const { api, calls } = fakeApi(() => Response.json({}));
    expect(await pauseWarnings(form({ paused: "1" }), api)).toBe(true);
    expect(await pauseWarnings(form({ paused: "0" }), api)).toBe(true);
    expect(calls.map((call) => [call.method, call.path, call.body])).toEqual([
      ["POST", "/desk/warnings", { paused: true }],
      ["POST", "/desk/warnings", { paused: false }],
    ]);
    const refused = fakeApi(() => Response.json(envelope("desk.notAllowed"), { status: 403 }));
    expect(await pauseWarnings(form({}), refused.api)).toBe(false);
  });
});

describe("the numbers of the pilot", () => {
  test("the list is read with the menu's counts, or refused", async () => {
    const { api, calls } = fakeApi(() => Response.json({ items: [] }));
    expect(await loadDeskPilot(api)).toMatchObject({ kind: "pilot", pilot: { items: [] } });
    expect(calls.map((call) => call.path)).toEqual(["/desk/pilot", "/desk/summary"]);
    const refused = fakeApi(() => Response.json(envelope("desk.notAllowed"), { status: 403 }));
    expect(await loadDeskPilot(refused.api)).toMatchObject({ kind: "refused", status: 403 });
  });

  test("a number is posted, or taken away by its key, and named on the page after", async () => {
    const { api, calls } = fakeApi(() => Response.json({}));
    expect(await actOnDeskPilot(form({ action: "add", number: "0800", officerRegency: "Uji" }), api)).toMatchObject({
      location: "/lapor/meja/pilot?saved=allowed",
    });
    expect(await actOnDeskPilot(form({ action: "remove", key: "abc" }), api)).toMatchObject({
      location: "/lapor/meja/pilot?saved=removed",
    });
    expect(calls).toEqual([
      { method: "POST", path: "/desk/pilot", body: { number: "0800", officerRegency: "Uji" } },
      { method: "DELETE", path: "/desk/pilot/abc", body: { confirm: true } },
    ]);
  });

  test("a refused one is drawn again with what was typed", async () => {
    const { api } = fakeApi(() => Response.json(envelope("request.invalidFields"), { status: 422 }));
    expect(await actOnDeskPilot(form({ action: "add", number: "12" }), api)).toMatchObject({
      kind: "render",
      status: 422,
      typed: { values: { number: "12" } },
    });
  });
});

describe("signing in and out", () => {
  test("a code is posted and the cookie goes on with the redirect; a refused code renders", async () => {
    const signed = fakeApi(
      () => new Response(null, { status: 204, headers: { "set-cookie": "seeded_session=a; Path=/" } }),
    );
    const acted = await actOnDesk(form({ action: "signIn", code: "abc" }), signed.api);
    expect(signed.calls[0]).toEqual({ method: "POST", path: "/desk/session", body: { code: "abc" } });
    expect(acted.kind === "redirect" && acted.headers.get("set-cookie")).toBe("seeded_session=a; Path=/");
    const out = fakeApi(() => new Response(null, { status: 204 }));
    expect(await actOnDesk(form({ action: "signOut" }), out.api)).toMatchObject({ location: "/lapor/meja" });
    expect(out.calls[0]?.method).toBe("DELETE");
    // From the report start the way out leads back to it, and to no other place.
    expect(await actOnDesk(form({ action: "signOut", next: "/lapor/report" }), out.api)).toMatchObject({
      location: "/lapor/report",
    });
    expect(await actOnDesk(form({ action: "signOut", next: "https://elsewhere.test" }), out.api)).toMatchObject({
      location: "/lapor/meja",
    });
    const refused = await actOnDesk(
      new FormData(),
      fakeApi(() => Response.json(envelope("request.invalidFields"), { status: 422 })).api,
    );
    expect(refused).toMatchObject({ kind: "render", status: 422 });
  });
});

describe("the desk's copy", () => {
  test("holds every key a report's rows are drawn with", () => {
    const texts = pickTexts(PAGE_TEXTS.desk);
    for (const key of [
      "card.summary.row",
      "card.placeSearch.rowVillage",
      "card.placeSearch.rowPlace",
      "card.placeConfirm.accuracy",
      "field.dead.label",
      "unit.people",
      "value.eventTime.dateOnly",
      "state.none",
      "desk.origin.quote",
      "stage.long.seen",
    ])
      expect(texts[key], key).toBeDefined();
  });
});
