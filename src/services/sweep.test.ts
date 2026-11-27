import { beforeAll, describe, expect, test } from "vitest";
import { api } from "../api/app";
import { RETENTION } from "../domain/retention";
import { browser, freshNumber, manualClock, query, testBindings, testDatabase } from "../testing/api";
import { turn } from "../testing/walk";
import { runSweep } from "./sweep";

// The clock is set before every row the other test files write, so this run touches only its own rows.
const T0 = Date.parse("2025-12-01T03:00:00.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const clock = manualClock(T0);
const { bindings, lines } = testBindings({}, { clock });
const db = testDatabase();
const fetchApi = (request: Request) => api.app.fetch(request, bindings);

let village = "";
beforeAll(async () => {
  const [row] = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active order by v.code limit 1`;
  village = (row as { code: string }).code;
});

async function draftWithTurn() {
  const phone = browser(fetchApi);
  const started = await phone.call("POST", "/consent", {
    role: "citizen",
    name: "Uji Satu",
    number: freshNumber().typed,
    privacyVersion: 2,
    agree: true,
  });
  const answered = await phone.call(
    "POST",
    `/drafts/${started.draft.draftId}/turns`,
    turn(started.draft, { villageCode: village }),
  );
  expect(answered.status).toBe(200);
  return { phone, id: started.draft.draftId };
}

const draftRow = async (id: string) => {
  const [row] = await query<{ state: string; has_fields: number; messages: number; replies: number }>`
    select d.state, d.fields is not null as has_fields,
      (select count(*) from draft_message m where m.draft_id = d.id) as messages,
      (select count(*) from turn_reply r where r.draft_id = d.id) as replies
    from report_draft d where d.id = ${id}`;
  return row;
};

describe("the scheduled sweep", () => {
  test("expires due drafts, keeps one tapped in time, prunes and removes old rows", async () => {
    const due = await draftWithTurn();
    const tapped = await draftWithTurn();
    const oldDevice = await draftWithTurn();

    clock.set(T0 + DAY - MINUTE);
    expect((await tapped.phone.call("GET", `/drafts/${tapped.id}`)).status).toBe(200);

    const now = T0 + DAY + MINUTE;
    clock.set(now);
    const at = (ms: number) => new Date(now - ms);
    const [device] = await query<{ device_id: string; reporter_id: string }>`
      select p.device_id, p.reporter_id from report_draft d join reporter_profile p on p.id = d.profile_id
      where d.id = ${oldDevice.id}`;
    const { device_id: deviceId, reporter_id: reporterId } = device as { device_id: string; reporter_id: string };
    await query`update device set last_seen_at = ${at(RETENTION.deviceUnseenMs + MINUTE)} where id = ${deviceId}`;
    const [kept] = await query<{ device_id: string }>`
      select p.device_id from report_draft d join reporter_profile p on p.id = d.profile_id where d.id = ${tapped.id}`;
    const keptDevice = (kept as { device_id: string }).device_id;
    await query`update device set last_seen_at = ${at(RETENTION.deviceUnseenMs - DAY)} where id = ${keptDevice}`;

    const subject = `sweep-test-${crypto.randomUUID()}`;
    await query`insert into rate_counter (limit_id, subject_key, window_start, count) values
      ('message.minute', ${subject}, ${at(RETENTION.rateCounterMs + MINUTE)}, 3),
      ('message.minute', ${subject}, ${at(DAY)}, 4)`;
    await query`insert into model_usage (number_key, wib_date, calls) values
      (${subject}, '2025-11-30', 9), (${subject}, '2025-12-01', 8)`;
    await query`insert into gateway_message (gateway_id, message_id, received_at) values
      ('uji', ${`${subject}-old`}, ${at(RETENTION.gatewayMessageMs + MINUTE)}),
      ('uji', ${`${subject}-new`}, ${at(MINUTE)})`;
    await query`insert into chat_session (number_key, step, shared_point, updated_at) values
      (${`${subject}-old`}, null, null, ${at(RETENTION.chatSessionMs + MINUTE)}),
      (${`${subject}-new`}, null, null, ${at(MINUTE)})`;

    const ended = await draftWithTurn();
    const recent = await draftWithTurn();
    for (const [id, age] of [
      [ended.id, RETENTION.emptiedDraftMs + MINUTE],
      [recent.id, RETENTION.emptiedDraftMs - DAY],
    ] as const) {
      await query`update report_draft set state = 'cancelled', end_reason = 'cancelled', ended_at = ${at(age)},
        fields = null, back_stack = null, last_acted_at = ${at(age)} where id = ${id}`;
    }

    await runSweep(db, bindings.photos, clock, bindings.log);

    expect(await draftRow(due.id)).toEqual({ state: "expired", has_fields: 0, messages: 0, replies: 0 });
    expect(await draftRow(tapped.id)).toMatchObject({ state: "neighbourhood", has_fields: 1 });
    expect((await draftRow(tapped.id))?.messages).toBeGreaterThan(0);
    // Its stored turn reply is older than a day, so it goes while the draft stays.
    expect((await draftRow(tapped.id))?.replies).toBe(0);
    expect(await draftRow(ended.id)).toBeUndefined();
    expect(await draftRow(recent.id)).toMatchObject({ state: "cancelled" });

    const counters = await query<{ count: number }>`select count from rate_counter where subject_key = ${subject}`;
    expect(counters.map((row) => row.count)).toEqual([4]);
    const usage = await query<{ calls: number }>`select calls from model_usage where number_key = ${subject}`;
    expect(usage.map((row) => row.calls)).toEqual([8]);
    expect(await query`select message_id from gateway_message where message_id like ${`${subject}%`}`).toEqual([
      { message_id: `${subject}-new` },
    ]);
    expect(await query`select number_key from chat_session where number_key like ${`${subject}%`}`).toEqual([
      { number_key: `${subject}-new` },
    ]);
    expect(await query`select 1 from device where id = ${deviceId}`).toHaveLength(0);
    expect(await query`select 1 from reporter_profile where device_id = ${deviceId}`).toHaveLength(0);
    expect(await query`select 1 from reporter where id = ${reporterId}`).toHaveLength(0);
    expect(await query`select 1 from device where id = ${keptDevice}`).toHaveLength(1);
    expect(lines.at(-1)).toMatchObject({ event: "sweep.done" });

    // Run again at once, it finds nothing left to do.
    expect(await draftRow(tapped.id)).toMatchObject({ state: "neighbourhood", has_fields: 1 });
    expect(await runSweep(db, bindings.photos, clock, bindings.log)).toEqual({
      expired: 0,
      pruned: 0,
      devicesRemoved: 0,
      draftsRemoved: 0,
      missingAnonymised: 0,
      photoFilesRemoved: 0,
      videoUploadsDropped: 0,
      caseFilesErased: 0,
      caseVideoUploadsDropped: 0,
    });
  });

  test("a step runs batch after batch until one comes back short", async () => {
    clock.set(T0);
    const subject = `sweep-batch-${crypto.randomUUID()}`;
    const old = new Date(T0 - RETENTION.rateCounterMs - DAY);
    await query`with recursive n (i) as (select 1 union all select i + 1 from n where i < ${RETENTION.batch + 1})
      insert into rate_counter (limit_id, subject_key, window_start, count)
      select 'message.minute', ${subject}, strftime('%Y-%m-%dT%H:%M:%fZ', ${old}, '-' || i || ' minutes'), 1 from n`;
    const counts = await runSweep(db, bindings.photos, clock, bindings.log);
    expect(counts.pruned).toBeGreaterThanOrEqual(RETENTION.batch + 1);
    expect(await query`select 1 from rate_counter where subject_key = ${subject}`).toHaveLength(0);
  });
});
