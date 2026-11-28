import { describe, expect, test } from "vitest";
import { failingDatabase, freshNumber, manualClock, query, testBindings } from "../../testing/api";
import { allow, GATEWAY_SECRETS, gateway } from "../../testing/gateway";
import { api } from "../app";

const { bindings } = testBindings({ GATEWAY_SECRETS: `${GATEWAY_SECRETS} uji-2=${"x".repeat(32)}` });
const one = gateway((request) => api.app.fetch(request, bindings));
const body = () => ({ number: freshNumber().stored.slice(1), channel: "wa", text: "halo" });
// The same from a number of the pilot.
const allowedBody = async () => {
  const { stored } = freshNumber();
  await allow(stored);
  return { number: stored.slice(1), channel: "wa", text: "halo" };
};

const codeOf = (json: Record<string, unknown>) => (json.error as { code: string }).code;
const ids = async (messageId: string) =>
  query<{ gateway_id: string }>`select gateway_id from gateway_message where message_id = ${messageId}`;

describe("a gateway's signed calls (AC-05)", () => {
  test("a signed message is answered, once", async () => {
    const sent = await allowedBody();
    const messageId = crypto.randomUUID();
    const first = await one.call("POST", "/gateway/messages", sent, { messageId });
    expect(first.status).toBe(200);
    expect(first.text).toContain("Setuju");
    const sessions = await query`select * from chat_session`;
    const again = await one.call("POST", "/gateway/messages", sent, { messageId });
    expect([again.status, codeOf(again.json)]).toEqual([409, "gateway.replayed"]);
    expect(await query`select * from chat_session`).toEqual(sessions);
    expect(await ids(messageId)).toEqual([{ gateway_id: "uji-1" }]);
    // Another gateway's ids are its own.
    const other = await one.call("POST", "/gateway/messages", sent, { messageId, id: "uji-2", secret: "x".repeat(32) });
    expect(other.status).toBe(200);
  });

  test("a call that is not whole is refused the same way, and writes nothing", async () => {
    const before = await query`select count(*) as n from gateway_message`;
    const refusals = [
      await one.call("POST", "/gateway/messages", body(), { secret: "another-gateway-secret-of-32-bytes!" }),
      await one.call("POST", "/gateway/messages", body(), { id: "uji-9" }),
      await one.call("POST", "/gateway/messages", body(), { timeMs: Date.now() - 6 * 60_000 }),
      await one.call("POST", "/gateway/messages", body(), { timeMs: Date.now() + 6 * 60_000 }),
      await one.call("POST", "/gateway/messages", body(), { tampered: JSON.stringify(body()) }),
      await one.call("POST", "/gateway/messages", body(), { messageId: "x" }),
      await one.call("POST", "/gateway/photos", { number: "6280000000001", data: "" }, { id: "uji-9" }),
      await one.call("GET", "/gateway/languages", undefined, { secret: "another-gateway-secret-of-32-bytes!" }),
    ];
    for (const refusal of refusals) expect([refusal.status, codeOf(refusal.json)]).toEqual([401, "gateway.refused"]);
    expect(await query`select count(*) as n from gateway_message`).toEqual(before);
  });

  test("a browser's write without a signature is refused, whatever its origin", async () => {
    const response = await api.app.fetch(
      new Request("http://localhost/api/gateway/messages", {
        method: "POST",
        headers: {
          "x-client-address": "203.0.113.9",
          origin: "http://localhost:5173",
          "x-respon-client": "1",
          "content-type": "application/json",
        },
        body: JSON.stringify(body()),
      }),
      bindings,
    );
    expect(response.status).toBe(401);
  });

  test("with no gateway set the door is shut", async () => {
    const shut = testBindings().bindings;
    const call = gateway((request) => api.app.fetch(request, shut)).call;
    expect((await call("POST", "/gateway/messages", body())).status).toBe(401);
  });

  test("a write that fails on our side gives its message id back", async () => {
    const messageId = crypto.randomUUID();
    const sent = await allowedBody();
    // The id is taken, then everything after it fails.
    const failing = {
      ...bindings,
      clock: {
        now: (() => {
          let calls = 0;
          return () => {
            calls += 1;
            if (calls === 2) throw new Error("clock stopped");
            return Date.now();
          };
        })(),
      },
    };
    const failed = await gateway((request) => api.app.fetch(request, failing)).call("POST", "/gateway/messages", sent, {
      messageId,
    });
    expect([failed.status, codeOf(failed.json)]).toEqual([503, "request.unavailable"]);
    expect(await ids(messageId)).toEqual([]);
    expect((await one.call("POST", "/gateway/messages", sent, { messageId })).status).toBe(200);
  });

  test("no message id can be taken while the database is down", async () => {
    const down = { ...bindings, db: failingDatabase("database busy", "57P03") };
    const failed = await gateway((request) => api.app.fetch(request, down)).call("POST", "/gateway/messages", body());
    expect(failed.status).toBe(503);
  });

  test("a time on the edge is good", async () => {
    const clock = manualClock("2026-11-25T03:00:00.000Z");
    const at = testBindings({ GATEWAY_SECRETS }, { clock }).bindings;
    const call = gateway((request) => api.app.fetch(request, at), { timeMs: clock.now() - 300_000 }).call;
    expect((await call("GET", "/gateway/languages")).status).toBe(200);
  });
});

describe("what a gateway sends", () => {
  test("the languages a chat may be held in", async () => {
    const languages = await one.call("GET", "/gateway/languages");
    expect(languages.json).toEqual({ languages: [{ code: "id", name: "Bahasa Indonesia" }] });
    // A read uses no message id up.
    const messageId = crypto.randomUUID();
    await one.call("GET", "/gateway/languages", undefined, { messageId });
    expect((await one.call("GET", "/gateway/languages", undefined, { messageId })).status).toBe(200);
  });

  test("a number, words and a photo that cannot be read are refused", async () => {
    const wrongNumber = { error: "Nomor WhatsApp tidak sah." };
    expect(await one.call("POST", "/gateway/messages", { number: "12", text: "halo" })).toMatchObject({
      status: 400,
      json: wrongNumber,
    });
    expect((await one.call("POST", "/gateway/messages", { ...body(), text: "  " })).status).toBe(400);
    expect((await one.call("POST", "/gateway/messages", { number: body().number })).status).toBe(400);
    expect((await one.call("POST", "/gateway/messages", { text: "halo" })).status).toBe(400);
    expect(await one.call("POST", "/gateway/photos", { number: "12", data: "AAAA" })).toMatchObject({
      status: 400,
      json: wrongNumber,
    });
    expect(await one.call("POST", "/gateway/photos", { number: body().number, data: "%%%" })).toMatchObject({
      status: 400,
      json: { error: "Foto tidak terbaca." },
    });
  });

  test("a message over 16 KB is refused, a photo is not", async () => {
    expect((await one.call("POST", "/gateway/messages", { ...body(), text: "x".repeat(17_000) })).status).toBe(413);
    const { number } = await allowedBody();
    expect((await one.call("POST", "/gateway/photos", { number, data: "A".repeat(40_000) })).status).toBe(409);
  });
});
