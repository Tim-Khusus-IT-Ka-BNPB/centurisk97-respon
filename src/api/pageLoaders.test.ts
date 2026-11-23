import { describe, expect, test } from "vitest";
import { browser, freshNumber, manualClock, query, TEST_ORIGIN, testBindings } from "../testing/api";
import { turn } from "../testing/walk";
import { api } from "./app";
import { createBridge } from "./bridge";
import type { ApiBindings } from "./context";
import { type DraftPageLoad, draftPageLoad } from "./pageLoaders";

const clock = manualClock("2026-11-23T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });

async function reporter() {
  const phone = browser((request: Request) => api.app.fetch(request, bindings));
  const started = await phone.call("POST", "/consent", {
    role: "citizen",
    name: "Uji Satu",
    number: freshNumber().typed,
    privacyVersion: 1,
    agree: true,
  });
  const cookie = [...phone.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  const load = (query: string, draftId = started.draft.draftId, with_: ApiBindings = bindings) => {
    const page = new Request(`${TEST_ORIGIN}/lapor/report/${draftId}?${query}`, {
      headers: { cookie, "cf-connecting-ip": phone.address },
    });
    const bridge = createBridge(async (request) => api.app.fetch(request, with_), TEST_ORIGIN, page);
    return draftPageLoad(draftId, new URL(page.url).searchParams, bridge);
  };
  return { phone, draft: started.draft, load };
}

const cardOf = (loaded: DraftPageLoad) => (loaded.kind === "draft" ? loaded.draft.card : null);

describe("the draft page with no script", () => {
  test("with no query the place card is drawn as stored", async () => {
    const { load } = await reporter();
    const loaded = await load("");
    expect(loaded).toMatchObject({ kind: "draft", status: 200, envelope: null });
    expect(cardOf(loaded)).toMatchObject({ kind: "placeSearch", query: null, places: null });
  });

  test("a typed place lists the results, the total and the cut flag inside the card", async () => {
    const { load } = await reporter();
    const card = cardOf(await load("q=%20sukamaju%20"));
    expect(card).toMatchObject({ kind: "placeSearch", query: "sukamaju", places: { total: 72, cut: true } });
    expect(card?.kind === "placeSearch" && card.places?.items).toHaveLength(10);
  });

  test("a picked regency lists its villages under its name, filtered by the typed words", async () => {
    const { load } = await reporter();
    const card = cardOf(await load("area=11.08"));
    expect(card).toMatchObject({
      kind: "regencyVillages",
      titleKey: "card.regencyVillages.title",
      params: { areaName: "Aceh Utara" },
      areaCode: "11.08",
      areaLevel: "regency",
      query: null,
      places: { total: 844, cut: true, dataDate: "2026-10-25" },
    });
    expect(card && "places" in card && card.places && Object.keys(card.places).sort()).toEqual([
      "cut",
      "dataDate",
      "items",
      "total",
    ]);
    const district = cardOf(await load("area=11.08.01&q=zzqx"));
    expect(district).toMatchObject({
      kind: "regencyVillages",
      areaLevel: "district",
      query: "zzqx",
      places: { total: 0 },
    });
  });

  test("an area not in the place data falls back to the search across the country", async () => {
    const { load } = await reporter();
    expect(cardOf(await load("area=99.99&q=sukamaju"))).toMatchObject({ kind: "placeSearch", places: { total: 72 } });
    expect(cardOf(await load("area=nonsense"))).toMatchObject({ kind: "placeSearch", places: null });
  });

  test("a query too short keeps the typed text and names the field", async () => {
    const { load } = await reporter();
    const loaded = await load("q=su");
    expect(loaded).toMatchObject({ kind: "draft", status: 422 });
    expect(loaded.kind === "draft" && loaded.envelope?.fields[0]?.copyKey).toBe("fieldError.query.tooShort");
    expect(cardOf(loaded)).toMatchObject({ kind: "placeSearch", query: "su", places: null });
  });

  test("unreadable place data says so, keeps the draft at place, and works inside an area too", async () => {
    const { load, draft } = await reporter();
    const { bindings: faulty } = testBindings({ FAULT_PLACE: "on" }, { clock });
    for (const query of ["q=sukamaju", "area=11.08"]) {
      const loaded = await load(query, draft.draftId, faulty);
      expect(loaded).toMatchObject({ kind: "draft", status: 503, draft: { state: "place" } });
      expect(loaded.kind === "draft" && loaded.envelope?.error.code).toBe("place.unavailable");
    }
  });

  test("past the place card the card is not touched by a query", async () => {
    const { phone, draft, load } = await reporter();
    const [village] = await query<{ code: string }>`
      select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active limit 1`;
    await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(draft, { villageCode: village?.code }));
    expect(cardOf(await load("q=sukamaju"))).toMatchObject({ kind: "neighbourhood" });
  });

  test("a draft that is not this reporter's is refused with its envelope", async () => {
    const { load } = await reporter();
    const loaded = await load("", crypto.randomUUID());
    expect(loaded).toMatchObject({ kind: "refused", status: 404, envelope: { error: { code: "draft.notFound" } } });
  });
});
