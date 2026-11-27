import { describe, expect, test } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { browser, freshAddress, freshNumber, manualClock, query, testBindings } from "../../testing/api";
import { turn } from "../../testing/walk";
import { api } from "../app";

const clock = manualClock("2026-11-23T03:00:00.000Z");
const { bindings, lines } = testBindings({}, { clock });
const fetchApi = (request: Request) => api.app.fetch(request, bindings);

const HOUR = 3_600_000;
const sessionOf = (index: 0 | 1 | 2) => {
  const phone = browser(fetchApi);
  phone.cookies.set("seeded_session", SEEDED_SESSIONS[index].token);
  return phone;
};

async function start(phone = browser(fetchApi), number = freshNumber().typed) {
  const answer = await phone.call("POST", "/consent", {
    role: "citizen",
    name: "Uji Satu",
    number,
    privacyVersion: 2,
    agree: true,
  });
  return { phone, draft: answer.draft };
}

describe("who may read a draft", () => {
  test("another device, a session of another number and a staff session each get 404, the same as a made-up draft", async () => {
    const { draft } = await start();
    const made = await browser(fetchApi).call("POST", "/consent", {
      role: "citizen",
      name: "Uji Dua",
      number: freshNumber().typed,
      privacyVersion: 2,
      agree: true,
    });
    const otherDevice = browser(fetchApi);
    otherDevice.cookies.set("device_key", "not-a-key-anyone-has");
    const deviceB = (await start()).phone;
    for (const caller of [deviceB, sessionOf(1), sessionOf(2)]) {
      const read = await caller.call("GET", `/drafts/${draft.draftId}`);
      expect(read.status).toBe(404);
      expect(read.error.error.code).toBe("draft.notFound");
    }
    expect((await deviceB.call("GET", "/drafts/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await deviceB.call("GET", "/drafts/not-a-uuid")).status).toBe(404);
    expect(
      (await deviceB.call("POST", `/drafts/${made.draft.draftId}/turns`, turn(made.draft, { kind: "back" }))).status,
    ).toBe(404);
    expect((await otherDevice.call("GET", `/drafts/${draft.draftId}`)).status).toBe(401);
  });

  test("no key and no session answers 401 asking to sign in, for a read, a turn and a send", async () => {
    const { draft } = await start();
    const nobody = browser(fetchApi);
    for (const answer of [
      await nobody.call("GET", `/drafts/${draft.draftId}`),
      await nobody.call("POST", `/drafts/${draft.draftId}/turns`, turn(draft, { kind: "back" })),
      await nobody.call("POST", `/drafts/${draft.draftId}/send`, { revision: 0, turnKey: crypto.randomUUID() }),
    ]) {
      expect(answer.status).toBe(401);
      expect(answer.error.error).toEqual({ code: "auth.signInFirst", copyKey: "error.auth.signInFirst", params: {} });
    }
  });

  test("the session of the draft's number also reads its device draft", async () => {
    const seeded = await query<{ number: string }>`
      select r.number from reporter r join seeded_session s on s.reporter_id = r.id order by r.number limit 1`;
    const { draft } = await start(browser(fetchApi), (seeded[0] as { number: string }).number.replace("+62", "0"));
    expect((await sessionOf(0).call("GET", `/drafts/${draft.draftId}`)).status).toBe(200);
  });
});

describe("expiry", () => {
  test("23 hours after the last act the owner resumes, and the draft is kept until 24 hours from now", async () => {
    const { phone, draft } = await start();
    clock.advance(23 * HOUR);
    const read = await phone.call("GET", `/drafts/${draft.draftId}`);
    expect(read.status).toBe(200);
    expect(read.draft.keptUntil.utc).toBe(new Date(clock.now() + 24 * HOUR).toISOString());
    expect(read.draft.notices.map((notice) => notice.copyKey)).toEqual(["notice.lifeLine"]);
    expect(read.draft.transcript.length).toBeGreaterThan(0);
  });

  test("25 hours after the last act the owner is told it expired, no row holds its content, and another device gets 404", async () => {
    const { phone, draft } = await start();
    await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(draft, { kind: "freeText", text: "air masuk rumah" }),
    );
    clock.advance(25 * HOUR);
    const read = await phone.call("GET", `/drafts/${draft.draftId}`);
    expect(read.status).toBe(410);
    expect(read.error.error).toEqual({ code: "draft.expired", copyKey: "card.expired.body", params: {} });
    const [left] = await query<{ state: string; fields: unknown; messages: number }>`
      select state, fields, (select count(*) from draft_message where draft_id = ${draft.draftId}) as messages
      from report_draft where id = ${draft.draftId}`;
    expect(left).toEqual({ state: "expired", fields: null, messages: 0 });
    expect((await phone.call("GET", `/drafts/${draft.draftId}`)).status).toBe(410);
    expect((await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(draft, { kind: "back" }))).status).toBe(
      410,
    );
    expect((await (await start()).phone.call("GET", `/drafts/${draft.draftId}`)).status).toBe(404);
  });

  test("a turn that lands before the read expires the draft keeps it", async () => {
    const { phone, draft } = await start();
    clock.advance(24 * HOUR - 1000);
    const kept = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(draft, { kind: "freeText", text: "air masuk rumah" }),
    );
    expect(kept.status).toBe(200);
    clock.advance(2000);
    expect((await phone.call("GET", `/drafts/${draft.draftId}`)).status).toBe(200);
  });
});

describe("limits", () => {
  test("20 messages a minute pass and the 21st is refused naming the limit, the retry time with zone and the 112 line, keeping the draft", async () => {
    const { phone, draft } = await start();
    let current = draft;
    clock.set(Date.parse("2026-11-23T05:00:00.000Z"));
    for (let message = 0; message < 20; message += 1) {
      const told = await phone.call(
        "POST",
        `/drafts/${draft.draftId}/turns`,
        turn(current, { kind: "freeText", text: `air ${message}` }),
      );
      expect(told.status).toBe(200);
      current = told.draft;
    }
    const refused = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(current, { kind: "freeText", text: "air lagi" }),
    );
    expect(refused.status).toBe(429);
    expect(refused.error.error).toEqual({
      code: "limit.message.minute",
      copyKey: "limit.message.minute",
      params: { limit: 20 },
    });
    expect(refused.error.retryAt).toEqual({ utc: "2026-11-23T05:01:00.000Z", zone: "WIB" });
    expect(refused.error.draft?.revision).toBe(current.revision);
    expect(refused.error.draft?.notices[0]?.copyKey).toBe("notice.lifeLine");
  });

  test("a message of 2,000 characters passes and one of 2,001 is refused with its length, storing nothing", async () => {
    const { phone, draft } = await start();
    const long = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(draft, { kind: "freeText", text: "a".repeat(2001) }),
    );
    expect(long.status).toBe(422);
    expect(long.error.fields).toEqual([
      { fieldId: "text", copyKey: "fieldError.message.tooLong", params: { length: 2001 } },
    ]);
    expect(long.error.draft?.revision).toBe(draft.revision);
    expect(
      (
        await phone.call(
          "POST",
          `/drafts/${draft.draftId}/turns`,
          turn(draft, { kind: "freeText", text: "a".repeat(2000) }),
        )
      ).status,
    ).toBe(200);
  });

  test("a spoofed x-forwarded-for is ignored and a request with no cf-connecting-ip is refused with 400", async () => {
    const headers = {
      origin: "http://localhost:5173",
      "x-respon-client": "1",
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.9",
    };
    const body = JSON.stringify({
      role: "citizen",
      name: "Uji Satu",
      number: freshNumber().typed,
      privacyVersion: 2,
      agree: true,
    });
    const refused = await fetchApi(new Request("http://localhost/api/consent", { method: "POST", headers, body }));
    expect(refused.status).toBe(400);
    const address = freshAddress();
    for (let binding = 0; binding < 60; binding += 1)
      await browser(fetchApi, address).call(
        "POST",
        "/consent",
        JSON.parse(body.replace(/0800\d+/, freshNumber().typed)),
      );
    const spoofed = await fetchApi(
      new Request("http://localhost/api/consent", {
        method: "POST",
        headers: { ...headers, "cf-connecting-ip": address },
        body,
      }),
    );
    expect(spoofed.status).toBe(429);
  });
});

describe("logs", () => {
  test("no log line holds a reporter's name, number or words", async () => {
    const number = freshNumber();
    const { phone, draft } = await start(browser(fetchApi), number.typed);
    await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(draft, { kind: "freeText", text: "Uji Satu melihat air" }),
    );
    const text = JSON.stringify(lines);
    expect(lines.length).toBeGreaterThan(0);
    for (const secret of ["Uji Satu", number.typed, number.stored, "melihat air"]) expect(text).not.toContain(secret);
  });
});
