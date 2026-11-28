import { beforeAll, describe, expect, test } from "vitest";
import type { DraftBody } from "../../contract/draft";
import { browser, freshNumber, manualClock, query, testBindings, unusedDay } from "../../testing/api";
import { walkTo } from "../../testing/walk";
import { api } from "../app";

let village = "";
beforeAll(async () => {
  const [first] = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active
    where v.search_text like '%sukamaju%' order by v.code limit 1`;
  village = (first as { code: string }).code;
});

// A WIB date no other run has used, so its ticket counter starts where the test sets it.
function world(day: string, overrides: Record<string, string> = {}) {
  const clock = manualClock(`${day}T03:00:00.000Z`);
  const { bindings } = testBindings(overrides, { clock });
  const fetchApi = (request: Request) => api.app.fetch(request, bindings);
  return { clock, fetchApi };
}

async function atSummary(w: ReturnType<typeof world>, phone = browser(w.fetchApi), number = freshNumber().typed) {
  const start = await phone.call("POST", "/consent", {
    role: "citizen",
    name: "Uji Satu",
    number,
    privacyVersion: 2,
    agree: true,
  });
  const { draft } = await walkTo(phone, start.draft, village, { tick: () => w.clock.advance(4000) });
  return { phone, draft };
}

const send = (phone: ReturnType<typeof browser>, draft: DraftBody, turnKey: string = crypto.randomUUID()) =>
  phone.call("POST", `/drafts/${draft.draftId}/send`, { revision: draft.revision, turnKey });

async function counts(draftId: string) {
  const [row] = await query<{ reports: number; versions: number; tickets: number; history: number }>`
    select (select count(*) from report where draft_id = ${draftId}) as reports,
      (select count(*) from report_version v join report r on r.id = v.report_id where r.draft_id = ${draftId}) as versions,
      (select count(*) from ticket t join report r on r.id = t.report_id where r.draft_id = ${draftId} and t.status = 'new') as tickets,
      (select count(*) from ticket_history h join report r on r.ticket_number = h.ticket_number where r.draft_id = ${draftId} and h.from_status is null and h.to_status = 'new' and h.actor = 'system') as history`;
  return row;
}

describe("send", () => {
  test("Kirim writes report, first version, ticket at new and its first history row, with the next number of the WIB day", async () => {
    const day = await unusedDay(0);
    const w = world(day);
    const { phone, draft } = await atSummary(w);
    const sent = await send(phone, draft);
    expect(sent.status).toBe(201);
    const [year, month, date] = day.split("-");
    expect(sent.json).toEqual({
      ticketNumber: `LA-${date}${month}${year?.slice(2)}-01`,
      sentAt: { utc: expect.any(String), zone: "WIB" },
    });
    expect(await counts(draft.draftId)).toEqual({ reports: 1, versions: 1, tickets: 1, history: 1 });
    const [version] = await query<{
      reporter_name: string;
      privacy_version: number;
      complete_percent: number;
      number_unverified: number;
    }>`
      select v.reporter_name, v.privacy_version, v.complete_percent, r.number_unverified from report_version v join report r on r.id = v.report_id
      where r.draft_id = ${draft.draftId}`;
    expect(version).toEqual({
      reporter_name: "Uji Satu",
      privacy_version: 2,
      complete_percent: 100,
      number_unverified: true,
    });
    const [left] = await query<{
      state: string;
      fields: unknown;
    }>`select state, fields from report_draft where id = ${draft.draftId}`;
    expect(left).toEqual({ state: "sent", fields: null });
    const read = await phone.call("GET", `/drafts/${draft.draftId}`);
    expect(read.draft.card).toMatchObject({
      kind: "sent",
      ticketNumber: (sent.json as { ticketNumber: string }).ticketNumber,
    });
  });

  test("the sequence goes from 99 to 100 with no cut", async () => {
    const w = world(await unusedDay(99));
    const { phone, draft } = await atSummary(w);
    expect(((await send(phone, draft)).json as { ticketNumber: string }).ticketNumber).toMatch(/-100$/);
  });

  test("two Kirim at once with two keys give exactly one ticket, and both answers name it", async () => {
    const w = world(await unusedDay(0));
    const { phone, draft } = await atSummary(w);
    const answers = await Promise.all([send(phone, draft), send(phone, draft), send(phone, draft)]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(answers.map((answer) => (answer.json as { ticketNumber: string }).ticketNumber)).size).toBe(1);
    expect(await counts(draft.draftId)).toEqual({ reports: 1, versions: 1, tickets: 1, history: 1 });
  });

  test("a retry with the same key after a lost answer shows the same ticket", async () => {
    const w = world(await unusedDay(0));
    const { phone, draft } = await atSummary(w);
    const key = crypto.randomUUID();
    const first = await send(phone, draft, key);
    const retry = await send(phone, draft, key);
    expect(retry.status).toBe(200);
    expect(retry.json).toEqual(first.json);
    const other = await phone.call("POST", `/drafts/${draft.draftId}/send`, {
      revision: draft.revision + 5,
      turnKey: key,
    });
    expect(other.error.error.code).toBe("turn.keyReused");
  });

  test("with the fault switch on, nothing is written, it says so, and the draft stays at the summary", async () => {
    const day = await unusedDay(0);
    const w = world(day, { FAULT_SEND: "on" });
    const { phone, draft } = await atSummary(w);
    const failed = await send(phone, draft);
    expect(failed.status).toBe(503);
    expect(failed.error.error.code).toBe("send.failed");
    expect(failed.error.draft?.card.kind).toBe("summary");
    expect(await counts(draft.draftId)).toEqual({ reports: 0, versions: 0, tickets: 0, history: 0 });
    expect(await query`select 1 from ticket_day_counter where wib_date = ${day}`).toHaveLength(0);
    expect((await phone.call("GET", `/drafts/${draft.draftId}`)).draft.state).toBe("summary");
  });

  test("a stale revision or a draft not at the summary is told the draft changed", async () => {
    const w = world(await unusedDay(0));
    const { phone, draft } = await atSummary(w);
    const stale = await phone.call("POST", `/drafts/${draft.draftId}/send`, {
      revision: draft.revision - 1,
      turnKey: crypto.randomUUID(),
    });
    expect(stale.status).toBe(409);
    expect(stale.error.draft?.card.kind).toBe("summary");
    const early = await browser(w.fetchApi).call("POST", "/consent", {
      role: "citizen",
      name: "Uji Satu",
      number: freshNumber().typed,
      privacyVersion: 2,
      agree: true,
    });
    expect(
      (await phone.call("POST", `/drafts/${early.draft.draftId}/send`, { revision: 0, turnKey: crypto.randomUUID() }))
        .status,
    ).toBe(404);
  });

  test("a number sends 5 in a rolling 24 hours; the sixth is refused with the time a send is allowed again", async () => {
    const w = world(await unusedDay(0));
    const phone = browser(w.fetchApi);
    const number = freshNumber().typed;
    const firstSentAt = w.clock.now() + 0;
    // A report an hour, as a person sends them: the hourly message limit is not what is tested here.
    for (let index = 0; index < 5; index += 1) {
      const { draft } = await atSummary(w, phone, number);
      expect((await send(phone, draft)).status).toBe(201);
      w.clock.advance(3_600_000);
    }
    const { draft } = await atSummary(w, phone, number);
    const refused = await send(phone, draft);
    expect(refused.status).toBe(429);
    expect(refused.error.error).toEqual({
      code: "limit.send.rolling",
      copyKey: "limit.send.rolling",
      params: { limit: 5 },
    });
    const retryAt = Date.parse(refused.error.retryAt?.utc as string);
    expect(retryAt).toBeGreaterThan(firstSentAt + 86_400_000);
    expect(retryAt).toBeLessThan(firstSentAt + 86_400_000 + 10 * 60_000);
    expect(refused.error.draft?.state).toBe("summary");
    expect(refused.error.draft?.notices[0]?.copyKey).toBe("notice.lifeLine");
    w.clock.set(retryAt + 1);
    expect((await send(phone, draft)).status).toBe(201);
  }, 60_000);

  test("at the cap, two tabs sending the last open draft at once give one ticket and no sixth", async () => {
    const w = world(await unusedDay(0));
    const phone = browser(w.fetchApi);
    const number = freshNumber().typed;
    for (let index = 0; index < 4; index += 1) {
      const { draft } = await atSummary(w, phone, number);
      await send(phone, draft);
      w.clock.advance(3_600_000);
    }
    const { draft } = await atSummary(w, phone, number);
    const tabs = await Promise.all([send(phone, draft), send(phone, draft)]);
    expect(tabs.map((tab) => tab.status).sort()).toEqual([200, 201]);
    const { draft: sixth } = await atSummary(w, phone, number);
    expect((await send(phone, sixth)).status).toBe(429);
  }, 60_000);
});

describe("one lock order", () => {
  test("a draft that has lost its profile is never sent", async () => {
    const w = world(await unusedDay(0));
    const { phone, draft } = await atSummary(w);
    await query`update report_draft set profile_id = null where id = ${draft.draftId}`;
    const refused = await send(phone, draft);
    expect(refused.status).toBe(409);
    expect(await counts(draft.draftId)).toEqual({ reports: 0, versions: 0, tickets: 0, history: 0 });
  });

  test("Kirim racing Buat laporan baru or Hapus on the same number never deadlocks into a 503", async () => {
    const w = world(await unusedDay(0));
    const statuses: string[] = [];
    for (let round = 0; round < 8; round += 1) {
      const { phone, draft } = await atSummary(w);
      const me = (await phone.call("GET", "/me")).json as { knownReporters: { profileId: string }[] };
      const profileId = me.knownReporters[0]?.profileId as string;
      const other =
        round % 2 === 0
          ? phone.call("POST", "/drafts", { profileId, replaceOpenDraft: true })
          : phone.call("DELETE", `/me/profiles/${profileId}`, { confirm: true });
      const [sent, raced] = await Promise.all([send(phone, draft), other]);
      statuses.push(`${sent.status}/${raced.status}`);
    }
    // Either one goes first: the send wins (201), or the draft was ended first (409), or removed with
    // its number (404); the other always answers.
    expect(statuses.filter((pair) => pair.includes("503"))).toEqual([]);
    expect(statuses.every((pair) => /^(201|409|404)\/(201|204)$/.test(pair))).toBe(true);
  }, 180_000);
});

describe("the numbers near a sent report", () => {
  test("from its village's centre, two of each kind within 30 km; none with no centre or no file", async () => {
    const w = world(await unusedDay(0));
    const sentIn = async (code: string) => {
      const phone = browser(w.fetchApi);
      const start = await phone.call("POST", "/consent", {
        role: "citizen",
        name: "Uji Satu",
        number: freshNumber().typed,
        privacyVersion: 2,
        agree: true,
      });
      const { draft } = await walkTo(phone, start.draft, code, { tick: () => w.clock.advance(4000) });
      expect((await send(phone, draft)).status).toBe(201);
      const read = (await phone.call("GET", `/drafts/${draft.draftId}`)).json as {
        card: { nearest: { kind: string; km: number }[] };
      };
      return read.card.nearest;
    };
    // Cot Seumiyong, Aceh Utara, has an outline and so a centre.
    const near = await sentIn("11.08.03.2031");
    expect(near.length).toBeGreaterThan(0);
    expect(near.every((one) => one.km <= 30)).toBe(true);
    const order = ["rs", "puskesmas", "polisi", "damkar"];
    const kinds = near.map((one) => order.indexOf(one.kind));
    expect(kinds).toEqual([...kinds].sort((a, b) => a - b));
    // A village with no outline has no centre to measure from.
    await query`delete from place_village_shape where code = '11.08.01.2002'`;
    expect(await sentIn("11.08.01.2002")).toEqual([]);
    await query`delete from reference_file where name = 'facilityNumbers'`;
    expect(await sentIn("11.08.03.2031")).toEqual([]);
  });
});
