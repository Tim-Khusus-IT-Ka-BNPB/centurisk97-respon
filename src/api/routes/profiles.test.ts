import { describe, expect, test } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import type { MeResponse } from "../../contract/draft";
import { browser, freshNumber, manualClock, query, testBindings } from "../../testing/api";
import { turn } from "../../testing/walk";
import { api } from "../app";

const clock = manualClock("2026-11-23T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchApi = (request: Request) => api.app.fetch(request, bindings);

const consent = (phone: ReturnType<typeof browser>, number: string, name: string) =>
  phone.call("POST", "/consent", { role: "citizen", name, number, privacyVersion: 1, agree: true });
const me = async (phone: ReturnType<typeof browser>) => (await phone.call("GET", "/me")).json as MeResponse;

async function deviceWith(names: readonly string[]) {
  const phone = browser(fetchApi);
  const numbers = names.map(() => freshNumber());
  const drafts = [];
  for (const [index, name] of names.entries()) {
    clock.advance(60_000);
    drafts.push((await consent(phone, (numbers[index] as { typed: string }).typed, name)).draft);
  }
  return { phone, numbers, drafts };
}

describe("numbers known on this device", () => {
  test("are listed latest first with name, masked number and the open draft", async () => {
    const { phone, numbers, drafts } = await deviceWith(["Uji Satu", "Uji Dua", "Uji Tiga"]);
    const known = await me(phone);
    expect(known.knownReporters.map((row) => row.name)).toEqual(["Uji Tiga", "Uji Dua", "Uji Satu"]);
    const last = numbers[2] as { stored: string };
    expect(known.knownReporters[0]?.maskedNumber).toBe(`0${last.stored.slice(3, 6)}****${last.stored.slice(-4)}`);
    expect(known.knownReporters[0]?.openDraft).toEqual({
      draftId: drafts[2]?.draftId,
      hazardType: null,
      lastActedAt: { utc: new Date(clock.now()).toISOString(), zone: "WIB" },
    });
    expect(known.session).toBeNull();
    expect(JSON.stringify(known)).not.toContain(last.stored);
  });

  test("a device with nothing known, and a staff session, list nobody", async () => {
    expect(await me(browser(fetchApi))).toEqual({ knownReporters: [], privacyVersion: 1, session: null });
    const desk = browser(fetchApi);
    desk.cookies.set("seeded_session", SEEDED_SESSIONS[2].token);
    expect((await me(desk)).session).toEqual({ kind: "staff" });
  });

  test("a second device typing the same number never sees the first device's name", async () => {
    const number = freshNumber();
    await consent(browser(fetchApi), number.typed, "Uji Satu");
    const other = browser(fetchApi);
    expect((await me(other)).knownReporters).toEqual([]);
    await consent(other, number.typed, "Uji Dua");
    expect((await me(other)).knownReporters.map((row) => row.name)).toEqual(["Uji Dua"]);
  });
});

describe("starting from a known number", () => {
  test("an open draft past its 24 hours is expired, not offered, when the number starts again", async () => {
    const { phone, drafts } = await deviceWith(["Uji Satu"]);
    clock.advance(25 * 3_600_000);
    const profileId = (await me(phone)).knownReporters[0]?.profileId as string;
    const fresh = await phone.call("POST", "/drafts", { profileId });
    expect(fresh.status).toBe(201);
    expect(fresh.draft.draftId).not.toBe(drafts[0]?.draftId);
    const [old] = await query<{
      state: string;
      fields: unknown;
    }>`select state, fields from report_draft where id = ${drafts[0]?.draftId as string}`;
    expect(old).toEqual({ state: "expired", fields: null });
  });

  test("with a draft open it asks first; replacing it removes the old content and starts at the place", async () => {
    const { phone, drafts } = await deviceWith(["Uji Satu"]);
    const old = drafts[0] as NonNullable<(typeof drafts)[number]>;
    await phone.call("POST", `/drafts/${old.draftId}/turns`, turn(old, { kind: "freeText", text: "air masuk rumah" }));
    const profileId = (await me(phone)).knownReporters[0]?.profileId as string;
    const asked = await phone.call("POST", "/drafts", { profileId });
    expect(asked.status).toBe(409);
    expect(asked.error.error).toEqual({
      code: "draft.openExists",
      copyKey: "card.confirm.replaceDraft.body",
      params: { hazardType: "resume.noHazardType" },
    });
    expect(asked.error.draft?.draftId).toBe(old.draftId);
    const replaced = await phone.call("POST", "/drafts", { profileId, replaceOpenDraft: true });
    expect(replaced.status).toBe(201);
    expect(replaced.draft.card.kind).toBe("placeSearch");
    const [left] = await query<{ state: string; fields: unknown; messages: number }>`
      select state, fields, (select count(*) from draft_message where draft_id = ${old.draftId}) as messages from report_draft where id = ${old.draftId}`;
    expect(left).toEqual({ state: "cancelled", fields: null, messages: 0 });
  });

  test("Ganti changes role and name, and the summary reporter follows", async () => {
    const { phone, drafts } = await deviceWith(["Uji Satu"]);
    const profileId = (await me(phone)).knownReporters[0]?.profileId as string;
    const changed = await phone.call("POST", "/drafts", {
      profileId,
      replaceOpenDraft: true,
      profileEdit: {
        role: "claimedOfficer",
        name: "Uji Dua",
        officerRegency: "Kabupaten Contoh",
        officerPosition: "Staf",
      },
    });
    expect(changed.status).toBe(201);
    expect(changed.draft.draftId).not.toBe(drafts[0]?.draftId);
    expect((await me(phone)).knownReporters[0]).toMatchObject({ name: "Uji Dua", role: "claimedOfficer" });
    const refused = await phone.call("POST", "/drafts", {
      profileId,
      replaceOpenDraft: true,
      profileEdit: { role: "claimedOfficer", name: "Uji Dua" },
    });
    expect(refused.status).toBe(422);
    expect(refused.error.fields.map((field) => field.fieldId)).toEqual(["officerRegency", "officerPosition"]);
  });

  test("a profile of another device or a made-up one is not found", async () => {
    const { phone } = await deviceWith(["Uji Satu"]);
    const profileId = (await me(phone)).knownReporters[0]?.profileId as string;
    const { phone: other } = await deviceWith(["Uji Dua"]);
    expect((await other.call("POST", "/drafts", { profileId })).status).toBe(404);
    const session = browser(fetchApi);
    session.cookies.set("seeded_session", SEEDED_SESSIONS[0].token);
    expect((await session.call("POST", "/drafts", { profileId })).status).toBe(404);
    expect((await other.call("POST", "/drafts", { profileId: "00000000-0000-4000-8000-000000000000" })).status).toBe(
      404,
    );
  });
});

describe("Hapus dari perangkat ini", () => {
  test("removes the number from the list, cancels its open draft, and frees a sixth slot", async () => {
    const { phone, drafts } = await deviceWith(["Uji Satu", "Uji Dua", "Uji Tiga", "Uji Empat", "Uji Lima"]);
    const known = await me(phone);
    const first = known.knownReporters.find((row) => row.name === "Uji Satu") as MeResponse["knownReporters"][number];
    expect((await consent(phone, freshNumber().typed, "Uji Enam")).status).toBe(429);
    const removed = await phone.call("DELETE", `/me/profiles/${first.profileId}`, { confirm: true });
    expect(removed.status).toBe(204);
    expect((await me(phone)).knownReporters.map((row) => row.name)).not.toContain("Uji Satu");
    // The number had nothing else, so its row went and took the emptied draft with it.
    expect(await query`select 1 from report_draft where id = ${drafts[0]?.draftId as string}`).toHaveLength(0);
    expect((await consent(phone, freshNumber().typed, "Uji Enam")).status).toBe(201);
  });

  test("the number row goes when nothing else uses it, and stays while another device holds it", async () => {
    const number = freshNumber();
    const a = browser(fetchApi);
    const b = browser(fetchApi);
    await consent(a, number.typed, "Uji Satu");
    await consent(b, number.typed, "Uji Satu");
    const remove = async (phone: ReturnType<typeof browser>) =>
      phone.call("DELETE", `/me/profiles/${(await me(phone)).knownReporters[0]?.profileId}`, { confirm: true });
    const draftOfA = (await me(a)).knownReporters[0]?.openDraft?.draftId as string;
    await remove(a);
    expect(await query`select 1 from reporter where number = ${number.stored}`).toHaveLength(1);
    const [left] = await query<{
      state: string;
      end_reason: string;
      fields: unknown;
    }>`select state, end_reason, fields from report_draft where id = ${draftOfA}`;
    expect(left).toEqual({ state: "cancelled", end_reason: "removedNumber", fields: null });
    await remove(b);
    expect(await query`select 1 from reporter where number = ${number.stored}`).toHaveLength(0);
  });

  test("needs the confirm, is refused for another device's profile, and a session has no removal", async () => {
    const { phone } = await deviceWith(["Uji Satu"]);
    const profileId = (await me(phone)).knownReporters[0]?.profileId as string;
    expect((await phone.call("DELETE", `/me/profiles/${profileId}`, { confirm: false })).status).toBe(400);
    const { phone: other } = await deviceWith(["Uji Dua"]);
    expect((await other.call("DELETE", `/me/profiles/${profileId}`, { confirm: true })).status).toBe(404);
    const session = browser(fetchApi);
    session.cookies.set("seeded_session", SEEDED_SESSIONS[1].token);
    expect((await session.call("DELETE", `/me/profiles/${profileId}`, { confirm: true })).status).toBe(404);
  });
});
