import { describe, expect, test } from "vitest";
import { LIMITS, type LimitId, windowStart } from "../../domain/limits";
import { PRIVACY } from "../../domain/privacy";
import { addressBucket } from "../../platform/address";
import { hmacKey } from "../../platform/keys";
import { browser, freshNumber, manualClock, query, testBindings } from "../../testing/api";
import { turn } from "../../testing/walk";
import { api } from "../app";

const clock = manualClock("2026-11-23T05:30:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchApi = (request: Request) => api.app.fetch(request, bindings);
const secret = bindings.settings.keyHmacSecret;

// Puts a counter one below its limit, so the next request is the one at the limit.
async function nearLimit(limitId: LimitId, subjectKey: string) {
  const window = LIMITS[limitId].window as "minute" | "clockHour" | "wibDay";
  await query`insert into rate_counter (limit_id, subject_key, window_start, count)
    values (${limitId}, ${subjectKey}, ${new Date(windowStart(window, clock.now()))}, ${LIMITS[limitId].max - 1})`;
}

async function started() {
  const number = freshNumber();
  const phone = browser(fetchApi);
  const answer = await phone.call("POST", "/consent", {
    role: "citizen",
    name: "Uji Satu",
    number: number.typed,
    privacyVersion: PRIVACY.version,
    agree: true,
  });
  const [device] = await query<{
    device_id: string;
  }>`select p.device_id from reporter_profile p join report_draft d on d.profile_id = p.id where d.id = ${answer.draft.draftId}`;
  const numberKey = await hmacKey(secret, "number", number.stored);
  return { phone, draft: answer.draft, deviceId: (device as { device_id: string }).device_id, numberKey };
}

const say = (phone: ReturnType<typeof browser>, draft: Awaited<ReturnType<typeof started>>["draft"]) =>
  phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(draft, { kind: "freeText", text: "air naik" }));

describe("each limit passes at its number and refuses one over, naming it with the retry time", () => {
  test.each([
    ["message.hour", "2026-11-23T06:00:00.000Z"],
    ["message.day", "2026-11-23T17:00:00.000Z"],
  ] as const)("%s, per number on this device", async (limitId, retry) => {
    const { phone, draft, deviceId, numberKey } = await started();
    await nearLimit(limitId, await hmacKey(secret, "subject", `${numberKey}:${deviceId}`));
    const atLimit = await say(phone, draft);
    expect(atLimit.status).toBe(200);
    const over = await say(phone, atLimit.draft);
    expect(over.status).toBe(429);
    expect(over.error.error).toEqual({
      code: `limit.${limitId}`,
      copyKey: `limit.${limitId}`,
      params: { limit: LIMITS[limitId].max },
    });
    expect(over.error.retryAt).toEqual({ utc: retry, zone: "WIB" });
  });

  test("device.messageHour, per device whatever the number", async () => {
    const { phone, draft, deviceId } = await started();
    await nearLimit("device.messageHour", await hmacKey(secret, "subject", `device:${deviceId}`));
    const atLimit = await say(phone, draft);
    expect(atLimit.status).toBe(200);
    expect((await say(phone, atLimit.draft)).error.error.code).toBe("limit.device.messageHour");
  });

  test("address.messages and address.draftReads, per address", async () => {
    const { phone, draft } = await started();
    const addressKey = await hmacKey(secret, "address", addressBucket(phone.address) as string);
    await nearLimit("address.messages", addressKey);
    const atLimit = await say(phone, draft);
    expect(atLimit.status).toBe(200);
    expect((await say(phone, atLimit.draft)).error.error.code).toBe("limit.address.messages");
    await nearLimit("address.draftReads", addressKey);
    expect((await phone.call("GET", `/drafts/${draft.draftId}`)).status).toBe(200);
    const refused = await phone.call("GET", `/drafts/${draft.draftId}`);
    expect(refused.status).toBe(429);
    expect(refused.error.error.code).toBe("limit.address.draftReads");
    expect(refused.error.retryAt).toEqual({ utc: "2026-11-23T06:00:00.000Z", zone: "WIB" });
  });
});
