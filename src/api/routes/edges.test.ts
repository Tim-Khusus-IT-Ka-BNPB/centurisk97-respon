import { beforeAll, describe, expect, test } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { type DraftRecord, expireDraft, loadDraft } from "../../adapters/postgres/drafts";
import { claimModelCall } from "../../adapters/postgres/limits";
import type { Card } from "../../contract/card";
import type { MeResponse } from "../../contract/draft";
import { PRIVACY } from "../../domain/privacy";
import type { Database } from "../../platform/database";
import {
  browser,
  failingDatabase,
  freshNumber,
  manualClock,
  query,
  TEST_ORIGIN,
  testBindings,
  testDatabase,
} from "../../testing/api";
import { defaultAnswer, turn, walkTo } from "../../testing/walk";
import { api } from "../app";
import { createBridge } from "../bridge";
import { draftPageAction } from "../pageActions";

const clock = manualClock(Date.parse("2026-11-23T03:00:00.000Z"));
const { bindings } = testBindings({}, { clock });
const db = testDatabase();
const fetchApi = (request: Request) => api.app.fetch(request, bindings);
const tick = () => clock.advance(4000);

let village = "";
beforeAll(async () => {
  const [first] = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active order by v.code limit 1`;
  village = (first as { code: string }).code;
});

async function start(phone = browser(fetchApi)) {
  const answer = await phone.call("POST", "/consent", {
    role: "citizen",
    name: "Uji Satu",
    number: freshNumber().typed,
    privacyVersion: PRIVACY.version,
    agree: true,
  });
  return { phone, draft: answer.draft };
}
const me = async (phone: ReturnType<typeof browser>) => (await phone.call("GET", "/me")).json as MeResponse;
const sessionOf = (index: 0 | 1) => {
  const phone = browser(fetchApi);
  phone.cookies.set("seeded_session", SEEDED_SESSIONS[index].token);
  return phone;
};

describe("identity edges", () => {
  test("an unknown session token is nobody", async () => {
    const { draft } = await start();
    const stranger = browser(fetchApi);
    stranger.cookies.set("seeded_session", "not-a-seeded-token");
    expect((await stranger.call("GET", `/drafts/${draft.draftId}`)).status).toBe(401);
  });

  test("a device must give a number", async () => {
    const answer = await browser(fetchApi).call("POST", "/consent", {
      role: "citizen",
      name: "Uji Satu",
      privacyVersion: PRIVACY.version,
      agree: true,
    });
    expect(answer.error.fields).toEqual([
      { fieldId: "number", copyKey: "fieldError.number.format", params: { label: "identity.number.label" } },
    ]);
  });

  test("a session cannot start from another session's profile", async () => {
    const own = sessionOf(1);
    await own.call("POST", "/consent", {
      role: "citizen",
      name: "Uji Dua",
      privacyVersion: PRIVACY.version,
      agree: true,
    });
    const profileId = (await me(own)).knownReporters[0]?.profileId as string;
    expect((await sessionOf(0).call("POST", "/drafts", { profileId })).status).toBe(404);
  });
});

describe("profile edges", () => {
  test("a number with no open draft lists none, starts with no confirm, and is removed with nothing to cancel", async () => {
    const { phone, draft } = await start();
    const asked = await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(draft, { kind: "cancel" }));
    await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(asked.draft, { kind: "confirm" }));
    const known = (await me(phone)).knownReporters[0] as MeResponse["knownReporters"][number];
    expect(known.openDraft).toBeNull();
    const fresh = await phone.call("POST", "/drafts", { profileId: known.profileId, replaceOpenDraft: true });
    expect(fresh.status).toBe(201);
    const again = await phone.call(
      "POST",
      `/drafts/${fresh.draft.draftId}/turns`,
      turn(fresh.draft, { kind: "cancel" }),
    );
    await phone.call("POST", `/drafts/${fresh.draft.draftId}/turns`, turn(again.draft, { kind: "confirm" }));
    expect((await phone.call("DELETE", `/me/profiles/${known.profileId}`, { confirm: true })).status).toBe(204);
  });

  test("the replace question names the open draft's hazard type", async () => {
    const { phone, draft } = await start();
    const { draft: hazard } = await walkTo(phone, draft, village, {
      tick,
      stopAt: (current) => current.card.kind === "choice",
    });
    await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(hazard, { optionIds: ["landslide"] }));
    const profileId = (await me(phone)).knownReporters[0]?.profileId as string;
    expect((await phone.call("POST", "/drafts", { profileId })).error.error.params).toEqual({
      hazardType: "hazard.landslide.label",
    });
  });
});

describe("turn edges", () => {
  test("a village that is not in the active snapshot names the place field", async () => {
    const { phone, draft } = await start();
    const answer = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(draft, { villageCode: "99.99.99.9999" }),
    );
    expect(answer.error.fields).toEqual([
      { fieldId: "villageCode", copyKey: "fieldError.required", params: { label: "field.place.label" } },
    ]);
  });

  test("the same turn sent twice at once is stored once, and both answers are the same", async () => {
    const { phone, draft } = await start();
    const body = turn(draft, { villageCode: village });
    const [first, second] = await Promise.all(
      [1, 2].map(() => phone.call("POST", `/drafts/${draft.draftId}/turns`, body)),
    );
    expect([first?.status, second?.status]).toEqual([200, 200]);
    expect(first?.json).toEqual(second?.json);
    const other = turn(draft, { villageCode: village });
    const answers = await Promise.all(
      [other, { ...other, cardId: "c-9" }].map((sent) => phone.call("POST", `/drafts/${draft.draftId}/turns`, sent)),
    );
    expect(answers.map((answer) => answer.status).sort()).toEqual([409, 409]);
  });

  test("the same key with another body at once is refused for one of them", async () => {
    const { phone, draft } = await start();
    const body = turn(draft, { villageCode: village });
    const answers = await Promise.all(
      [body, { ...body, villageCode: "11.08.01.2099" }].map((sent) =>
        phone.call("POST", `/drafts/${draft.draftId}/turns`, sent),
      ),
    );
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 422]);
  });

  test("a model that fails at once leaves the template reading", async () => {
    const failing = testBindings(
      { MODEL_MODE: "recorded", MODEL_BASE_URL: "http://localhost:8790", MODEL_NAME: "recorded" },
      { clock, model: { extract: () => Promise.reject(new Error("down")) } },
    ).bindings;
    const phone = browser((request) => api.app.fetch(request, failing));
    const { draft } = await start(phone);
    await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(draft, { kind: "freeText", text: "dua rumah rusak berat" }),
    );
    const [row] = await query<{
      fields: { states: Record<string, unknown> };
      model_calls: number;
    }>`select fields, model_calls from report_draft where id = ${draft.draftId}`;
    expect(row?.model_calls).toBe(1);
    expect(row?.fields.states.housesHeavy).toEqual({
      state: "value",
      value: 2,
      origin: "quote",
      quote: "dua rumah rusak berat",
    });
  });

  test("expiry does not empty a draft the reporter acted on after it was read", async () => {
    const { phone, draft } = await start();
    const read = (await loadDraft(db, draft.draftId)) as DraftRecord;
    clock.advance(1000);
    await phone.call("GET", `/drafts/${draft.draftId}`);
    await expireDraft(db, read, new Date(clock.now()));
    expect((await loadDraft(db, draft.draftId))?.state).toBe("place");
  });

  test("a session's turn counts against its number, with no device limit", async () => {
    // The seeded session's draft lives on between runs, so its minute is one no run has used.
    const own = testBindings(
      {},
      { clock: manualClock(Date.UTC(2060, 0, 1) + Math.floor(Math.random() * 1e11)) },
    ).bindings;
    const session = browser((request) => api.app.fetch(request, own));
    session.cookies.set("seeded_session", SEEDED_SESSIONS[1].token);
    const started = await session.call("POST", "/consent", {
      role: "citizen",
      name: "Uji Dua",
      privacyVersion: PRIVACY.version,
      agree: true,
    });
    const told = await session.call(
      "POST",
      `/drafts/${started.draft.draftId}/turns`,
      turn(started.draft, { kind: "freeText", text: "air naik" }),
    );
    expect(told.status).toBe(200);
  });

  test("a model call is not counted for a draft that is not one", async () => {
    await expect(claimModelCall(db, "not-a-uuid", "k", "2026-11-23", { draft: 30, day: 150 })).resolves.toBe(false);
    expect(await query`select 1 from model_usage where number_key = 'k'`).toHaveLength(0);
  });

  test("the walk has no answer for the summary", () => {
    expect(
      defaultAnswer(
        { kind: "cancelled", cardId: "c", titleKey: "card.cancelled.title", promptKey: null, params: {} } as Card,
        village,
      ),
    ).toBeNull();
  });

  test("a form turn with no kind is an answer, and one with no card id is still read", async () => {
    const { phone, draft } = await start();
    const cookie = [...phone.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const bridge = createBridge(
      async (request) => fetchApi(request),
      TEST_ORIGIN,
      new Request(`${TEST_ORIGIN}/report/x`, {
        method: "POST",
        headers: { origin: TEST_ORIGIN, cookie, "x-client-address": phone.address },
      }),
    );
    const form = new FormData();
    form.set("revision", "0");
    form.set("turnKey", crypto.randomUUID());
    form.set("text", "kembali");
    expect(await draftPageAction(draft.draftId, form, bridge)).toMatchObject({ kind: "render", status: 409 });
    form.set("kind", "freeText");
    form.set("turnKey", crypto.randomUUID());
    expect(await draftPageAction(draft.draftId, form, bridge)).toMatchObject({
      kind: "render",
      status: 422,
      envelope: { error: { code: "draft.nothingToUndo" } },
    });
  });
});

describe("dependencies down", () => {
  test("the health check answers 503 when the database cannot be read, and ok when it can", async () => {
    const broken = { ...bindings, db: failingDatabase("network lost") };
    const request = () =>
      new Request("http://localhost/api/health", { headers: { "x-client-address": "198.51.100.7" } });
    expect((await api.app.fetch(request(), broken)).status).toBe(503);
    expect(await (await api.app.fetch(request(), bindings)).text()).toBe("ok");
  });

  test("a database error in a send answers 503, logs its SQL state only, and writes nothing", async () => {
    const own = manualClock("2026-11-25T03:00:00.000Z");
    const { bindings: dayBindings, lines: dayLines } = testBindings({}, { clock: own });
    // The send's ticket counter fails as a driver error would; every other statement runs.
    const sendFails: Database = {
      query: (text, values) => db.query(text, values),
      batch: async (queries) => {
        if (queries.some((query) => query.text.includes("insert into ticket_day_counter")))
          throw Object.assign(new Error("could not write block near sukamaju"), { code: "58030" });
        return db.batch(queries);
      },
    };
    const phone = browser((request: Request) => api.app.fetch(request, { ...dayBindings, db: sendFails }));
    const { draft } = await start(phone);
    const { draft: summary } = await walkTo(phone, draft, village, { tick: () => own.advance(4000) });
    const failed = await phone.call("POST", `/drafts/${draft.draftId}/send`, {
      revision: summary.revision,
      turnKey: crypto.randomUUID(),
    });
    expect(failed.status).toBe(503);
    expect(failed.error.error.code).toBe("request.unavailable");
    expect(dayLines.filter((line) => line.event === "request.failed").at(-1)).toEqual({
      event: "request.failed",
      errorCode: "unexpected",
      sqlState: "58030",
    });
    expect(JSON.stringify(dayLines)).not.toContain("sukamaju");
    expect(await query`select 1 from report where draft_id = ${draft.draftId}`).toHaveLength(0);
  });
});
