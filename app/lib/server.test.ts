import { describe, expect, test } from "vitest";
import type { ApiCall } from "../../src/api/bridge";
import { SAMPLE_DRAFTS, SAMPLE_FIELD_ERROR, SAMPLE_ME } from "../../src/testing/samples";
import { actOnDraft, loadDraftPage } from "./draftPage.server";
import { actOnStart, loadStartPage, posterVillageCode } from "./startPage.server";
import { PAGE_TEXTS, pickTexts } from "./texts.server";

type Call = { method: string; path: string; body: unknown };

// A stand-in for the routes inside the Worker: answers by method and path, and keeps the calls.
function fakeApi(answers: Record<string, () => Response>) {
  const calls: Call[] = [];
  const api: ApiCall = async (method, path, body) => {
    calls.push({ method, path, body });
    const answer = answers[`${method} ${path.split("?")[0]}`];
    if (!answer) throw new Error(`no answer for ${method} ${path}`);
    return answer();
  };
  return { api, calls };
}

const json =
  (body: unknown, status = 200, headers: HeadersInit = {}) =>
  () =>
    Response.json(body, { status, headers });
const DRAFT = SAMPLE_DRAFTS.numberForm.draftId;
const PROFILE = SAMPLE_ME.knownReporters[0]?.profileId as string;

const form = (entries: readonly (readonly [string, string])[]) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};

describe("copy for a page", () => {
  test("a page gets its namespaces and every key its draft names, nothing more", () => {
    const texts = pickTexts(PAGE_TEXTS.help);
    expect(texts["help.group.reporting"]).toBe("Melapor");
    expect(texts["app.name"]).toBeDefined();
    expect(texts["card.summary.send"]).toBeUndefined();
    const draft = pickTexts(["app."], SAMPLE_DRAFTS.chronologyStep);
    expect(draft["chronology.flood.step2.option.slowRise.label"]).toBeDefined();
    expect(Object.keys(pickTexts(["app."], 7)).sort()).toEqual([
      "app.lang",
      "app.language.change",
      "app.language.close",
      ...["baliNusa", "java", "kalimantan", "malukuPapua", "national", "sulawesi", "sumatra"].map(
        (group) => `app.language.group.${group}`,
      ),
      "app.language.label",
      "app.language.open",
      "app.language.title",
      "app.name",
    ]);
  });
});

describe("the draft page", () => {
  test("a readable draft comes with a fresh turn key and only its copy", async () => {
    const { api } = fakeApi({ [`GET /drafts/${DRAFT}`]: json(SAMPLE_DRAFTS.numberForm) });
    const page = await loadDraftPage(DRAFT, new URL(`http://x/report/${DRAFT}?resume=1`), api, () => "k-1");
    expect(page.status).toBe(200);
    expect(page.data).toMatchObject({ kind: "draft", turnKey: "k-1", searching: false, envelope: null });
    expect(page.data.texts["field.dead.label"]).toBe("Meninggal");
    const search = await loadDraftPage(DRAFT, new URL(`http://x/report/${DRAFT}?q=suka`), api, () => "k-2");
    expect(search.data).toMatchObject({ searching: true });
  });

  test("a stranger's page carries only the not-found words, never the expired ones", async () => {
    const notFound = {
      ...SAMPLE_FIELD_ERROR,
      error: { code: "draft.notFound", copyKey: "error.draft.notFound", params: {} },
    };
    const { api } = fakeApi({ [`GET /drafts/${DRAFT}`]: json(notFound, 404) });
    const page = await loadDraftPage(DRAFT, new URL("http://x/"), api, () => "k");
    expect(page.data.texts["error.draft.notFound"]).toBeDefined();
    expect(page.data.texts["card.expired.title"]).toBeUndefined();
    expect(page.data.texts["card.expired.body"]).toBeUndefined();
    expect(page.data.texts["error.auth.signInFirst"]).toBeUndefined();
  });

  test("a draft that cannot be opened keeps its status and its refusal", async () => {
    const refusal = {
      ...SAMPLE_FIELD_ERROR,
      error: { code: "draft.expired", copyKey: "card.expired.body", params: {} },
    };
    const { api } = fakeApi({ [`GET /drafts/${DRAFT}`]: json(refusal, 410) });
    const page = await loadDraftPage(DRAFT, new URL("http://x/"), api, () => "k");
    expect(page.status).toBe(410);
    expect(page.data).toMatchObject({ kind: "refused", envelope: { error: { code: "draft.expired" } } });
    expect(page.data.texts["field.dead.label"]).toBeUndefined();
  });

  test("a stored turn redirects with the cookie and replaces the history entry", async () => {
    const { api, calls } = fakeApi({
      [`POST /drafts/${DRAFT}/turns`]: json(SAMPLE_DRAFTS.summary, 200, { "set-cookie": "a=b" }),
    });
    const acted = await actOnDraft(
      DRAFT,
      form([
        ["action", "turn"],
        ["dead", "2"],
        ["intent", "save"],
      ]),
      api,
    );
    expect(acted).toMatchObject({ kind: "redirect", location: `/report/${DRAFT}` });
    if (acted.kind !== "redirect") return;
    expect(acted.headers.get("set-cookie")).toBe("a=b");
    expect(acted.headers.get("X-Remix-Replace")).toBe("true");
    expect(calls[0]?.body).toMatchObject({ values: { dead: "2" } });
  });

  test("a refused turn is drawn again with every value as sent", async () => {
    const { api } = fakeApi({ [`POST /drafts/${DRAFT}/turns`]: json(SAMPLE_FIELD_ERROR, 422) });
    const acted = await actOnDraft(DRAFT, form([["dead", "dua"]]), api);
    expect(acted).toEqual({
      kind: "render",
      status: 422,
      data: { envelope: SAMPLE_FIELD_ERROR, posted: { dead: ["dua"] }, networkLost: false },
    });
  });
});

describe("the start step", () => {
  test("known numbers list first; a pick, a change or another number are pages of their own", async () => {
    const { api } = fakeApi({ "GET /me": json(SAMPLE_ME) });
    const at = (query: string) => loadStartPage(new URL(`http://x/report${query}`), api);
    expect(await at("")).toMatchObject({ view: "list", profileId: null, editing: false });
    expect(await at("?new=1")).toMatchObject({ view: "form", profileId: null });
    expect(await at(`?profile=${PROFILE}`)).toMatchObject({ view: "confirm", profileId: PROFILE });
    expect(await at(`?edit=${PROFILE}`)).toMatchObject({ view: "form", profileId: PROFILE, editing: true });
    expect(await at("?profile=someone-else")).toMatchObject({ view: "list", profileId: null });
  });

  test("with no known number, or none readable, the form shows", async () => {
    const none = fakeApi({ "GET /me": json({ ...SAMPLE_ME, knownReporters: [] }) });
    expect(await loadStartPage(new URL("http://x/"), none.api)).toMatchObject({ view: "form" });
    const down = fakeApi({ "GET /me": json(SAMPLE_FIELD_ERROR, 503) });
    expect(await loadStartPage(new URL("http://x/"), down.api)).toMatchObject({ view: "form", me: null });
  });

  test("consent redirects to the new draft with the device cookie", async () => {
    const { api } = fakeApi({ "POST /consent": json({ draftId: DRAFT }, 201, { "set-cookie": "device_key=x" }) });
    const acted = await actOnStart(
      form([
        ["action", "consent"],
        ["role", "citizen"],
        ["name", "Uji"],
        ["number", "080000000001"],
      ]),
      api,
    );
    expect(acted).toMatchObject({ kind: "redirect", location: `/report/${DRAFT}` });
  });

  test("consent to an emergency, and a known reporter's, start one", async () => {
    const { api, calls } = fakeApi({
      "POST /consent": json({ draftId: DRAFT }, 201),
      "POST /drafts": json({ draftId: DRAFT }, 201),
    });
    await actOnStart(form([["action", "consent"]]), api, true);
    await actOnStart(
      form([
        ["action", "useProfile"],
        ["profileId", "p-1"],
      ]),
      api,
      true,
    );
    expect(calls.map((call) => (call.body as { emergency: boolean }).emergency)).toEqual([true, true]);
  });

  test("a poster's village goes with the consent and a known reporter's start, and only then", async () => {
    const { api, calls } = fakeApi({
      "POST /consent": json({ draftId: DRAFT }, 201),
      "POST /drafts": json({ draftId: DRAFT }, 201),
    });
    await actOnStart(form([["action", "consent"]]), api, false, "11.08.01.2005");
    await actOnStart(
      form([
        ["action", "useProfile"],
        ["profileId", "p-1"],
      ]),
      api,
      false,
      "11.08.01.2005",
    );
    await actOnStart(form([["action", "consent"]]), api);
    expect(calls.map((call) => (call.body as { villageCode?: string }).villageCode)).toEqual([
      "11.08.01.2005",
      "11.08.01.2005",
      undefined,
    ]);
  });

  test("the poster's ten digits read as a village code; anything else is no village", () => {
    const read = (search: string) => posterVillageCode(new URL(`http://x/report${search}`));
    expect(read("?village=1108012005")).toBe("11.08.01.2005");
    expect([
      read(""),
      read("?village=110801200"),
      read("?village=11080120051"),
      read("?village=11.08.01.2005"),
    ]).toEqual([null, null, null, null]);
  });

  test("a read-back is drawn with the values typed", async () => {
    const { api } = fakeApi({});
    const acted = await actOnStart(
      form([
        ["action", "readBack"],
        ["role", "citizen"],
        ["name", "Uji Satu"],
        ["number", "080000000001"],
      ]),
      api,
    );
    expect(acted).toMatchObject({
      kind: "render",
      data: { view: "readBack", readBack: "+62 800 0000 0001", values: { name: "Uji Satu" }, removed: null },
    });
  });

  test("a removal shows the removed number in place; a failed one keeps the list with a notice", async () => {
    const removed = fakeApi({ [`DELETE /me/profiles/${PROFILE}`]: () => new Response(null, { status: 204 }) });
    const entries = [
      ["action", "removeProfile"],
      ["confirm", "yes"],
      ["profileId", PROFILE],
      ["maskedNumber", "0800****0001"],
    ] as const;
    expect(await actOnStart(form(entries), removed.api)).toMatchObject({
      kind: "render",
      data: { view: "list", removed: "0800****0001", profileId: PROFILE },
    });
    const failed = fakeApi({ [`DELETE /me/profiles/${PROFILE}`]: json(SAMPLE_FIELD_ERROR, 503) });
    expect(await actOnStart(form(entries), failed.api)).toMatchObject({
      kind: "render",
      status: 503,
      data: { view: "list", removeFailed: "0800****0001" },
    });
  });

  test("Ganti on the read-back draws the form again with focus on the number", async () => {
    const acted = await actOnStart(
      form([
        ["action", "changeNumber"],
        ["role", "citizen"],
        ["name", "Uji Satu"],
        ["number", "080000000001"],
      ]),
      fakeApi({}).api,
    );
    expect(acted).toMatchObject({
      kind: "render",
      data: { view: "form", focusNumber: true, values: { number: "080000000001" } },
    });
  });

  test("the home's new report removes the open draft by cancelling it, then goes to the identity choice", async () => {
    const turns: unknown[] = [];
    const { api } = fakeApi({
      [`GET /drafts/${DRAFT}`]: json({ ...SAMPLE_DRAFTS.numberForm, revision: 3 }),
      [`POST /drafts/${DRAFT}/turns`]: () => {
        const revision = 4 + turns.length;
        turns.push(revision);
        return Response.json({ ...SAMPLE_DRAFTS.numberForm, revision });
      },
    });
    const acted = await actOnStart(
      form([
        ["action", "discardOpenDraft"],
        ["draftId", DRAFT],
      ]),
      api,
    );
    expect(acted).toMatchObject({ kind: "redirect", location: "/report" });
    expect(turns).toHaveLength(2);
  });

  test("a draft that cannot be discarded is told on the list", async () => {
    const { api } = fakeApi({ [`GET /drafts/${DRAFT}`]: json(SAMPLE_FIELD_ERROR, 404) });
    expect(
      await actOnStart(
        form([
          ["action", "discardOpenDraft"],
          ["draftId", DRAFT],
        ]),
        api,
      ),
    ).toMatchObject({
      kind: "render",
      status: 404,
      data: { view: "list", envelope: { error: { code: "request.invalidFields" } } },
    });
    const refused = fakeApi({
      [`GET /drafts/${DRAFT}`]: json(SAMPLE_DRAFTS.numberForm),
      [`POST /drafts/${DRAFT}/turns`]: json(SAMPLE_FIELD_ERROR, 409),
    });
    expect(
      await actOnStart(
        form([
          ["action", "discardOpenDraft"],
          ["draftId", DRAFT],
        ]),
        refused.api,
      ),
    ).toMatchObject({
      kind: "render",
      status: 409,
    });
  });

  test("the home's offer opens its own confirm", async () => {
    const { api } = fakeApi({ "GET /me": json(SAMPLE_ME) });
    const at = (query: string) => loadStartPage(new URL(`http://x/report${query}`), api);
    expect(await at(`?discard=${PROFILE}`)).toMatchObject({ view: "discardConfirm", profileId: PROFILE });
  });

  test("changing a known profile is marked as such", async () => {
    const { api } = fakeApi({ "POST /drafts": json(SAMPLE_FIELD_ERROR, 422) });
    const acted = await actOnStart(
      form([
        ["action", "useProfile"],
        ["profileId", PROFILE],
        ["editProfile", "1"],
        ["role", "citizen"],
        ["name", "1"],
      ]),
      api,
    );
    expect(acted).toMatchObject({ kind: "render", data: { view: "form", editing: true, profileId: PROFILE } });
  });
});
