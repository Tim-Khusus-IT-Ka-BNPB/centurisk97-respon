import { beforeAll, describe, expect, test } from "vitest";
import { api } from "../api/app";
import type { ApiBindings } from "../api/context";
import type { DraftBody, MeResponse } from "../contract/draft";
import { type Database, decide } from "../platform/database";
import {
  browser,
  freshNumber,
  losesOnce,
  manualClock,
  query,
  racing,
  testBindings,
  testDatabase,
} from "../testing/api";
import { turn, walkTo } from "../testing/walk";

// Each write is decided on what was read and holds only if nothing changed since. These tests make
// another request win in between, and check the decision is made again on what is there now.
const clock = manualClock("2026-11-26T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
let db: Database = testDatabase();
const using = (raced: Database) => {
  db = raced;
};
const fetchApi = (request: Request) => api.app.fetch(request, { ...bindings, db } satisfies ApiBindings);
const tick = () => clock.advance(4000);

let village = "";
beforeAll(async () => {
  const [first] = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active order by v.code limit 1`;
  village = (first as { code: string }).code;
});

async function reporter(number = freshNumber().typed) {
  using(testDatabase());
  const phone = browser(fetchApi);
  const started = await phone.call("POST", "/consent", {
    role: "citizen",
    name: "Uji Satu",
    number,
    privacyVersion: 2,
    agree: true,
  });
  return { phone, number, draft: started.draft };
}

const profileOf = async (phone: ReturnType<typeof browser>) =>
  ((await phone.call("GET", "/me")).json as MeResponse).knownReporters[0]?.profileId as string;

describe("a write that loses its race is decided again", () => {
  test("three losses in a row is a fault, not a race", async () => {
    await expect(decide(async () => null)).rejects.toThrow("database.contended");
  });

  test("a repeated consent keeps the open draft", async () => {
    const { phone, number, draft } = await reporter();
    using(losesOnce("insert into reporter_consent"));
    const again = await phone.call("POST", "/consent", {
      role: "citizen",
      name: "Uji Satu",
      number,
      privacyVersion: 2,
      agree: true,
    });
    expect(again.draft.draftId).toBe(draft.draftId);
  });

  test("starting from a known number", async () => {
    const { phone } = await reporter();
    const profileId = await profileOf(phone);
    using(losesOnce("update reporter_profile"));
    const started = await phone.call("POST", "/drafts", { profileId, replaceOpenDraft: true });
    expect(started.status).toBe(201);
  });

  test("removing a number from the device", async () => {
    const { phone } = await reporter();
    const profileId = await profileOf(phone);
    using(losesOnce("delete from reporter_profile"));
    expect((await phone.call("DELETE", `/me/profiles/${profileId}`, { confirm: true })).status).toBe(204);
  });

  test("a turn whose own write landed first replays it", async () => {
    const { phone, draft } = await reporter();
    using(losesOnce("insert into turn_reply", async (write) => void (await write())));
    const answered = await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(draft, { villageCode: village }));
    expect(answered.status).toBe(200);
    expect(answered.draft.revision).toBe(draft.revision + 1);
  });

  test("a cancel that another turn beat is told the draft changed", async () => {
    const { phone, draft } = await reporter();
    const confirm = await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(draft, { kind: "cancel" }));
    using(losesOnce("end_reason"));
    const told = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(confirm.draft as DraftBody, { kind: "confirm" }),
    );
    expect(told.status).toBe(409);
    expect(told.error.error.code).toBe("draft.changed");
  });

  test("a send whose draft is removed before it is written is not found", async () => {
    const { phone, draft } = await reporter();
    const { draft: summary } = await walkTo(phone, draft, village, { tick });
    using(
      losesOnce("insert into ticket_day_counter", async () => {
        await query`delete from report_draft where id = ${draft.draftId}`;
      }),
    );
    const sent = await phone.call("POST", `/drafts/${draft.draftId}/send`, {
      revision: summary.revision,
      turnKey: crypto.randomUUID(),
    });
    expect(sent.status).toBe(404);
  });

  test("a send whose consent was read in the middle of a removal decides again", async () => {
    const { phone, draft } = await reporter();
    const { draft: summary } = await walkTo(phone, draft, village, { tick });
    let saved: Record<string, unknown>[] = [];
    let reads = 0;
    using(
      racing(
        async () => "pass",
        async (text) => {
          if (!text.includes("from reporter_consent")) return;
          reads += 1;
          if (reads === 1) {
            saved = await query`select * from reporter_consent`;
            await query`delete from reporter_consent`;
          }
          if (reads === 2)
            for (const one of saved)
              await query`insert into reporter_consent (id, profile_id, privacy_version, agreed_at)
                values (${one.id}, ${one.profile_id}, ${one.privacy_version}, ${one.agreed_at})`;
        },
      ),
    );
    const sent = await phone.call("POST", `/drafts/${draft.draftId}/send`, {
      revision: summary.revision,
      turnKey: crypto.randomUUID(),
    });
    expect(sent.status).toBe(201);
    expect(reads).toBe(2);
  });
});
