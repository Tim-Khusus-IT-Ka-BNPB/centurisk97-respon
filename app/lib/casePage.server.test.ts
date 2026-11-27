import { describe, expect, test } from "vitest";
import type { ApiCall } from "../../src/api/bridge";
import { CASE_VIEW } from "../testing/cases";
import { actOnCase, joinCase, loadCase, recordValues, tabOf } from "./casePage.server";

type Call = { readonly method: string; readonly path: string; readonly body: unknown };
const fakeApi = (answer: (call: Call) => Response) => {
  const calls: Call[] = [];
  const api: ApiCall = async (method, path, body) => {
    const call = { method, path, body };
    calls.push(call);
    return answer(call);
  };
  return { api, calls };
};
const form = (values: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values))
    for (const one of Array.isArray(value) ? value : [value]) data.append(name, one);
  return data;
};
const FILE = "f000000000000001";

describe("the follow-up file's page", () => {
  test("opens on the kind asked and the record being changed, else houses", () => {
    expect(tabOf(new URLSearchParams("jenis=evacuee&ubah=c000000000000001"))).toEqual({
      kind: "evacuee",
      editing: "c000000000000001",
    });
    expect(tabOf(new URLSearchParams("jenis=cats&ubah=x"))).toEqual({ kind: "house", editing: null });
    expect(tabOf(new URLSearchParams(""))).toEqual({ kind: "house", editing: null });
  });

  test("reads the file, or why not", async () => {
    const url = new URL("http://localhost/lapor/data/f?jenis=shelter");
    expect(await loadCase(FILE, url, fakeApi(() => Response.json(CASE_VIEW)).api)).toMatchObject({
      kind: "file",
      view: CASE_VIEW,
      tab: { kind: "shelter", editing: null },
    });
    expect(await loadCase(FILE, url, fakeApi(() => new Response("{}", { status: 401 })).api)).toMatchObject({
      kind: "signIn",
    });
    const refused = { error: { code: "cases.notFound" } };
    expect(await loadCase(FILE, url, fakeApi(() => Response.json(refused, { status: 404 })).api)).toMatchObject({
      kind: "refused",
      status: 404,
      envelope: refused,
    });
  });

  test("a record's values as the API reads them: yes or no, ticks, and empty boxes left out", () => {
    expect(
      recordValues(
        "evacuee",
        form({
          "v.name": " Uji ",
          "v.age": "30",
          "v.refusesPhoto": "no",
          "v.vulnerable": ["sick", "elderly"],
          "v.nik": "",
        }),
      ),
    ).toEqual({ name: "Uji", age: "30", refusesPhoto: false, vulnerable: ["sick", "elderly"] });
    expect(recordValues("house", form({ "v.flooded": "yes" }))).toEqual({ flooded: true });
    expect(recordValues("evacuee", form({ "v.name": "Uji" }))).toEqual({ name: "Uji" });
  });

  test("each form posts to its route, and a change kept goes back to its tab", async () => {
    const { api, calls } = fakeApi(() => Response.json({ recordId: "x" }));
    const acted = async (values: Record<string, string | string[]>) => actOnCase(FILE, form(values), api);
    expect(await acted({ intent: "record", kind: "house", "v.village": "Uji", lat: "5.1", lon: "97.2" })).toEqual({
      kind: "redirect",
      location: `/lapor/data/${FILE}?jenis=house&saved=record`,
    });
    await acted({ intent: "record", kind: "cats", "v.village": "Uji", lat: "x", lon: "97.2" });
    await acted({ intent: "update", kind: "shelter", recordId: "b1", revision: "2", "v.name": "Uji" });
    await acted({ intent: "update", kind: "cats", recordId: "b1", revision: "2", lat: "5", lon: "97" });
    await acted({ intent: "cancel", kind: "house", recordId: "a1", reason: "salah" });
    await acted({ intent: "nil", metric: "dead", nil: "1", revision: "3" });
    await acted({ intent: "nil", metric: "dead", nil: "0", revision: "3" });
    expect(await acted({ intent: "removeMember", memberId: "m1" })).toEqual({
      kind: "redirect",
      location: `/lapor/data/${FILE}?saved=removeMember`,
    });
    await acted({
      intent: "fields",
      revision: "3",
      emergencyStatus: "alert",
      decreeNumber: "",
      decreeDate: "",
      efforts: "Evakuasi",
      personnel: "40",
      postName: "Posko",
      postPhone: "0645",
    });
    await acted({ intent: "fields", revision: "3", personnel: "", postName: "" });
    await acted({ intent: "fields", revision: "3", personnel: "empat" });
    expect(calls.map((call) => [call.path, call.body])).toEqual([
      [`/cases/${FILE}/records`, { kind: "house", values: { village: "Uji" }, point: { lat: 5.1, lon: 97.2 } }],
      [`/cases/${FILE}/records`, { kind: "house", values: { village: "Uji" }, point: undefined }],
      [`/cases/${FILE}/records/b1`, { values: { name: "Uji" }, point: null, revision: 2 }],
      [`/cases/${FILE}/records/b1`, { values: {}, point: { lat: 5, lon: 97 }, revision: 2 }],
      [`/cases/${FILE}/records/a1/cancel`, { reason: "salah" }],
      [`/cases/${FILE}/nil`, { metric: "dead", nil: true, revision: 3 }],
      [`/cases/${FILE}/nil`, { metric: "dead", nil: false, revision: 3 }],
      [`/cases/${FILE}/members/m1/remove`, {}],
      [
        `/cases/${FILE}/fields`,
        {
          revision: 3,
          fields: {
            emergencyStatus: "alert",
            decreeNumber: "",
            decreeDate: "",
            efforts: "Evakuasi",
            personnel: 40,
            post: { name: "Posko", phone: "0645" },
          },
        },
      ],
      [
        `/cases/${FILE}/fields`,
        {
          revision: 3,
          fields: { emergencyStatus: "", decreeNumber: "", decreeDate: "", efforts: "", personnel: null, post: null },
        },
      ],
      [
        `/cases/${FILE}/fields`,
        {
          revision: 3,
          fields: {
            emergencyStatus: "",
            decreeNumber: "",
            decreeDate: "",
            efforts: "",
            personnel: "empat",
            post: null,
          },
        },
      ],
    ]);
  });

  test("a photo goes as its own form, with the phone's reading when sent", async () => {
    const { api, calls } = fakeApi(() => Response.json({ recordId: "a1" }));
    const data = form({ intent: "photo", kind: "house", recordId: "a1", lat: "5.1", lon: "", face: "1" });
    data.set("photo", new File([new Uint8Array([1])], "foto.jpg", { type: "image/jpeg" }));
    // A file is not what was typed: a refusal hands back the words only.
    const refused = fakeApi(() =>
      Response.json({ error: { code: "request.invalidFields" }, fields: [] }, { status: 422 }),
    );
    expect(await actOnCase(FILE, data, refused.api)).toMatchObject({
      typed: { intent: "photo", kind: "house", recordId: "a1" },
    });
    await actOnCase(FILE, data, api);
    const sent = calls[0]?.body as FormData;
    expect(calls[0]?.path).toBe(`/cases/${FILE}/records/a1/media`);
    expect([...sent.keys()]).toEqual(["photo", "face", "lat"]);
  });

  test("a new member's link and a record shown in full are answered on the page", async () => {
    const link = fakeApi(() => Response.json({ memberId: "m1", link: "http://x/lapor/data/masuk/abc" }));
    expect(await actOnCase(FILE, form({ intent: "member", name: "Uji", number: "0800" }), link.api)).toEqual({
      kind: "link",
      link: "http://x/lapor/data/masuk/abc",
      name: "Uji",
    });
    expect(await actOnCase(FILE, form({ intent: "renewLink", memberId: "m1", name: "Uji" }), link.api)).toMatchObject({
      kind: "link",
    });
    expect(link.calls.map((call) => call.path)).toEqual([`/cases/${FILE}/members`, `/cases/${FILE}/members/m1/link`]);
    const shown = fakeApi(() => Response.json({ personal: { name: "Uji" } }));
    expect(await actOnCase(FILE, form({ intent: "reveal", recordId: "c1" }), shown.api)).toEqual({
      kind: "revealed",
      recordId: "c1",
      personal: { name: "Uji" },
    });
    expect(shown.calls[0]?.path).toBe(`/cases/${FILE}/records/c1/reveal`);
  });

  test("a refusal is told with what was typed", async () => {
    const refused = { error: { code: "request.invalidFields" }, fields: [{ fieldId: "damage" }] };
    const { api } = fakeApi(() => Response.json(refused, { status: 422 }));
    expect(await actOnCase(FILE, form({ intent: "record", kind: "house", "v.damage": "x" }), api)).toEqual({
      kind: "render",
      status: 422,
      envelope: refused,
      typed: { intent: "record", kind: "house", "v.damage": "x" },
    });
  });

  test("a member's link is posted for, and its cookie set on the way to the file", async () => {
    const { api, calls } = fakeApi(
      () =>
        new Response(JSON.stringify({ fileId: FILE }), {
          headers: { "set-cookie": "lapor_data=abc; Path=/; HttpOnly", "content-type": "application/json" },
        }),
    );
    const joined = await joinCase("t1", api);
    expect(joined).toMatchObject({ kind: "joined", location: `/lapor/data/${FILE}` });
    expect(joined.kind === "joined" && joined.headers.get("set-cookie")).toBe("lapor_data=abc; Path=/; HttpOnly");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/case-links/t1" });
    const used = await joinCase(
      "t1",
      fakeApi(() => Response.json({ error: { code: "cases.linkUsed" } }, { status: 404 })).api,
    );
    expect(used).toEqual({ kind: "refused", envelope: { error: { code: "cases.linkUsed" } } });
  });
});
