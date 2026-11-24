import { describe, expect, test } from "vitest";
import type { ApiCall } from "../../src/api/bridge";
import { envelope } from "../../src/api/envelope";
import { actOnDesk, actOnDeskReport, filtersOf, loadDeskQueue, loadDeskReport, queueQuery } from "./deskPage.server";
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
    const load = await loadDeskQueue(new URL("http://x/lapor/meja?status=seen&hazardType=&ticket=LA-1&page=2"), api);
    expect(calls[0]?.path).toBe("/desk/reports?status=seen&period=all&ticket=LA-1&page=2");
    expect(load).toMatchObject({ kind: "queue", queue: QUEUE, envelope: null, filters: { status: "seen", page: 2 } });
    expect(queueQuery(filtersOf(new URLSearchParams("")))).toBe("?period=all");
    expect(filtersOf(new URLSearchParams("page=0")).page).toBe(1);
    expect(filtersOf(new URLSearchParams("page=x")).page).toBe(1);
    expect(queueQuery({ status: "", hazardType: "", period: "", ticket: "", page: 1 })).toBe("");
  });

  test("a refused search keeps the filters and says why; no staff account asks to sign in; others refuse", async () => {
    const field = envelope("request.invalidFields");
    const searched = await loadDeskQueue(
      new URL("http://x/lapor/meja?ticket=1"),
      fakeApi(() => Response.json(field, { status: 422 })).api,
    );
    expect(searched).toMatchObject({ kind: "queue", queue: null, envelope: field });
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

describe("a report on the desk", () => {
  test("is read by its ticket number, and an open is posted then shown again", async () => {
    const { api, calls } = fakeApi((method) =>
      method === "GET" ? Response.json({ ticketNumber: "LA-241126-01" }) : Response.json({}, { status: 200 }),
    );
    expect(await loadDeskReport("LA-241126-01", api)).toMatchObject({
      kind: "report",
      report: { ticketNumber: "LA-241126-01" },
    });
    expect(await actOnDeskReport("LA-241126-01", api)).toMatchObject({
      kind: "redirect",
      location: "/lapor/meja/LA-241126-01",
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /desk/reports/LA-241126-01",
      "POST /desk/reports/LA-241126-01/view",
    ]);
    const refused = await actOnDeskReport(
      "LA-241126-01",
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

describe("signing in and out", () => {
  test("a code is posted and the cookie goes on with the redirect; a refused code renders", async () => {
    const signed = fakeApi(
      () => new Response(null, { status: 204, headers: { "set-cookie": "seeded_session=a; Path=/" } }),
    );
    const acted = await actOnDesk(form({ action: "signIn", code: "abc" }), signed.api);
    expect(signed.calls[0]).toEqual({ method: "POST", path: "/desk/session", body: { code: "abc" } });
    expect(acted.kind === "redirect" && acted.headers.get("set-cookie")).toBe("seeded_session=a; Path=/");
    const out = fakeApi(() => new Response(null, { status: 204 }));
    await actOnDesk(form({ action: "signOut" }), out.api);
    expect(out.calls[0]?.method).toBe("DELETE");
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
