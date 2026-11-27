import { describe, expect, test } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { hmacKey } from "../../platform/keys";
import { browser, freshAddress, freshNumber, query, testBindings } from "../../testing/api";
import { api } from "../app";

const { bindings } = testBindings();
const fetchApi = (request: Request) => api.app.fetch(request, bindings);

const citizen = (number: string, name = "Uji Satu") => ({
  role: "citizen",
  name,
  number,
  privacyVersion: 2,
  agree: true,
});

async function stored(number: string) {
  const key = await hmacKey(bindings.settings.keyHmacSecret, "number", number);
  const [row] = await query<{ reporters: number; profiles: number; consents: number; drafts: number }>`
    select (select count(*) from reporter where number_key = ${key}) as reporters,
      (select count(*) from reporter_profile p join reporter r on r.id = p.reporter_id where r.number_key = ${key}) as profiles,
      (select count(*) from reporter_consent c join reporter_profile p on p.id = c.profile_id join reporter r on r.id = p.reporter_id where r.number_key = ${key}) as consents,
      (select count(*) from report_draft d join reporter r on r.id = d.reporter_id where r.number_key = ${key}) as drafts`;
  return row;
}

describe("consent", () => {
  test("Setuju with Ya stores number, binding, profile, consent and a draft at the place question", async () => {
    const phone = browser(fetchApi);
    const number = freshNumber();
    const before = Date.now();
    const answer = await phone.call("POST", "/consent", citizen(number.typed));
    expect(answer.status).toBe(201);
    expect(answer.draft.state).toBe("place");
    expect(answer.draft.card.kind).toBe("placeSearch");
    expect(answer.draft.notices.map((notice) => notice.copyKey)).toEqual(["notice.lifeLine"]);
    expect(answer.draft.transcript.map((line) => (line.speaker === "assistant" ? line.copyKey : ""))).toEqual([
      "chat.greeting",
      "card.placeSearch.title",
    ]);
    expect(phone.cookies.get("device_key")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await stored(number.stored)).toEqual({ reporters: 1, profiles: 1, consents: 1, drafts: 1 });
    const [consent] = await query<{ privacy_version: number; agreed_at: string }>`
      select c.privacy_version, c.agreed_at from reporter_consent c join reporter_profile p on p.id = c.profile_id
      join report_draft d on d.profile_id = p.id where d.id = ${answer.draft.draftId}`;
    expect(consent?.privacy_version).toBe(2);
    expect(Date.parse(consent?.agreed_at as string)).toBeGreaterThanOrEqual(before - 1000);
  });

  test("the device cookie is HttpOnly, Secure over https, SameSite Lax for a year, and only its fingerprint is stored", async () => {
    const consent = (origin: string) =>
      fetchApi(
        new Request(`${origin}/api/consent`, {
          method: "POST",
          headers: {
            "cf-connecting-ip": freshAddress(),
            origin,
            "x-respon-client": "1",
            "content-type": "application/json",
          },
          body: JSON.stringify(citizen(freshNumber().typed)),
        }),
      );
    const plain = (await consent("http://localhost:5173")).headers.get("set-cookie") as string;
    expect(plain).toMatch(/^device_key=[A-Za-z0-9_-]{43}; Max-Age=31536000; Path=\/; HttpOnly; SameSite=Lax$/);
    const request = new Request("https://localhost/api/consent", {
      method: "POST",
      headers: {
        "cf-connecting-ip": freshAddress(),
        origin: "http://localhost:5173",
        "x-respon-client": "1",
        "content-type": "application/json",
      },
      body: JSON.stringify(citizen(freshNumber().typed)),
    });
    const response = await fetchApi(request);
    const cookie = response.headers.get("set-cookie") as string;
    expect(cookie).toMatch(/^device_key=[A-Za-z0-9_-]{43}; Max-Age=31536000; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    const key = (cookie.split(";")[0] as string).split("=")[1] as string;
    expect(await query`select 1 from device where key_fingerprint = ${key}`).toHaveLength(0);
  });

  test("the number is stored as +62 whichever way it is typed: one number row for all three", async () => {
    const number = freshNumber();
    const national = number.stored.slice(3);
    for (const typed of [`0${national}`, `62${national.slice(0, 3)}-${national.slice(3)}`, `+62 ${national}`]) {
      expect((await browser(fetchApi).call("POST", "/consent", citizen(typed))).status).toBe(201);
    }
    expect(await stored(number.stored)).toEqual({ reporters: 1, profiles: 3, consents: 3, drafts: 3 });
    expect(await query`select 1 from reporter where number = ${number.stored}`).toHaveLength(1);
  });

  test("a refused form stores nothing and names each field", async () => {
    const number = freshNumber();
    const phone = browser(fetchApi);
    const answer = await phone.call("POST", "/consent", {
      role: "claimedOfficer",
      name: "Uji 123",
      number: number.typed,
      officerRegency: "Ka",
      privacyVersion: 2,
      agree: true,
    });
    expect(answer.status).toBe(422);
    expect(answer.error.error.code).toBe("request.invalidFields");
    expect(answer.error.fields).toEqual([
      { fieldId: "name", copyKey: "fieldError.name.digits", params: { label: "identity.name.label" } },
      {
        fieldId: "officerRegency",
        copyKey: "fieldError.officerRegency.tooShort",
        params: { label: "identity.officerRegency.label" },
      },
      {
        fieldId: "officerPosition",
        copyKey: "fieldError.required",
        params: { label: "identity.officerPosition.label" },
      },
    ]);
    expect(phone.cookies.size).toBe(0);
    expect(await stored(number.stored)).toEqual({ reporters: 0, profiles: 0, consents: 0, drafts: 0 });
  });

  test("a name of 81 letters is refused, never cut", async () => {
    const answer = await browser(fetchApi).call("POST", "/consent", citizen(freshNumber().typed, "a".repeat(81)));
    expect(answer.error.fields).toEqual([
      { fieldId: "name", copyKey: "fieldError.name.tooLong", params: { label: "identity.name.label", length: 81 } },
    ]);
    expect(
      (await browser(fetchApi).call("POST", "/consent", citizen(freshNumber().typed, "a".repeat(80)))).status,
    ).toBe(201);
  });

  test("consent needs agree and the current privacy version", async () => {
    const phone = browser(fetchApi);
    expect((await phone.call("POST", "/consent", { ...citizen(freshNumber().typed), agree: false })).status).toBe(400);
    expect((await phone.call("POST", "/consent", { ...citizen(freshNumber().typed), privacyVersion: 1 })).status).toBe(
      400,
    );
  });

  test("a repeated consent from the same device returns the draft already open", async () => {
    const phone = browser(fetchApi);
    const number = freshNumber();
    const first = await phone.call("POST", "/consent", citizen(number.typed));
    const second = await phone.call("POST", "/consent", citizen(number.typed, "Uji Dua"));
    expect(second.draft.draftId).toBe(first.draft.draftId);
    expect(await stored(number.stored)).toEqual({ reporters: 1, profiles: 1, consents: 2, drafts: 1 });
  });

  test("a device holds at most 5 numbers; the sixth is refused naming the limit", async () => {
    const phone = browser(fetchApi);
    for (let index = 0; index < 5; index += 1)
      expect((await phone.call("POST", "/consent", citizen(freshNumber().typed))).status).toBe(201);
    const sixth = freshNumber();
    const refused = await phone.call("POST", "/consent", citizen(sixth.typed));
    expect(refused.status).toBe(429);
    expect(refused.error.error).toEqual({
      code: "limit.device.numbers",
      copyKey: "limit.device.numbers",
      params: { limit: 5 },
    });
    expect(refused.error.retryAt).toBeNull();
    expect((await stored(sixth.stored))?.profiles).toBe(0);
  });

  test("eight consents at once on a device of one number give exactly four more bindings, never a sixth", async () => {
    const phone = browser(fetchApi);
    const first = await phone.call("POST", "/consent", citizen(freshNumber().typed));
    const answers = await Promise.all(
      Array.from({ length: 8 }, () => phone.call("POST", "/consent", citizen(freshNumber().typed))),
    );
    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 201, 201, 201, 429, 429, 429, 429]);
    const [device] = await query<{ count: number }>`
      select count(*) as count from reporter_profile where device_id =
        (select p.device_id from reporter_profile p join report_draft d on d.profile_id = p.id where d.id = ${first.draft.draftId})`;
    expect(device?.count).toBe(5);
  });

  test("new bindings from one address stop at 60 an hour", async () => {
    const address = freshAddress();
    for (let index = 0; index < 60; index += 1) {
      const answer = await browser(fetchApi, address).call("POST", "/consent", citizen(freshNumber().typed));
      expect(answer.status).toBe(201);
    }
    const refused = await browser(fetchApi, address).call("POST", "/consent", citizen(freshNumber().typed));
    expect(refused.status).toBe(429);
    expect(refused.error.error.code).toBe("limit.address.bindings");
    expect(refused.error.retryAt?.zone).toBe("WIB");
  }, 60_000);

  test("a session consents with no number and its draft opens from a second browser with that session", async () => {
    const token = SEEDED_SESSIONS[1].token;
    const first = browser(fetchApi);
    first.cookies.set("seeded_session", token);
    const answer = await first.call("POST", "/consent", {
      role: "citizen",
      name: "Uji Dua",
      privacyVersion: 2,
      agree: true,
    });
    expect(answer.status).toBe(201);
    expect(first.cookies.has("device_key")).toBe(false);
    const second = browser(fetchApi);
    second.cookies.set("seeded_session", token);
    expect((await second.call("GET", `/drafts/${answer.draft.draftId}`)).status).toBe(200);
    const me = await second.call("GET", "/me");
    expect(me.json).toMatchObject({ session: { kind: "reporter" }, privacyVersion: 2 });
  });

  test("a staff session cannot consent", async () => {
    const desk = browser(fetchApi);
    desk.cookies.set("seeded_session", SEEDED_SESSIONS[2].token);
    expect((await desk.call("POST", "/consent", citizen(freshNumber().typed))).status).toBe(404);
  });
});
