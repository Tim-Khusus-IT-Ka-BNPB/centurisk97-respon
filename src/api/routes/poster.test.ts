import { describe, expect, test } from "vitest";
import type { DraftBody } from "../../contract/draft";
import { PRIVACY } from "../../domain/privacy";
import { browser, freshNumber, query, testBindings, testDatabase } from "../../testing/api";
import { startDraft } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

const { bindings } = testBindings();
const fetchApi = (request: Request) =>
  api.app.fetch(request, { ...bindings, db: testDatabase() } satisfies ApiBindings);

const consent = (extra: object = {}) => ({
  role: "citizen",
  name: "Uji Poster",
  number: freshNumber().typed,
  privacyVersion: PRIVACY.version,
  agree: true,
  ...extra,
});

// A village of the seed, as a poster's code names it.
const POSTER = "11.08.03.2031";

describe("a report started from a village's poster (D131)", () => {
  test("opens with the poster's village as its place, says so, and asks what comes after it", async () => {
    const started = await browser(fetchApi).call("POST", "/consent", consent({ villageCode: POSTER }));
    expect(started.status).toBe(201);
    const draft = started.draft;
    expect(draft.card.kind).toBe("neighbourhood");
    const lines = draft.transcript.map((line) => ("copyKey" in line ? line.copyKey : null));
    expect(lines).toEqual(["chat.greeting", "chat.posterPlace", draft.card.titleKey]);
    expect(draft.transcript[1]).toMatchObject({
      params: { village: expect.any(String), district: expect.any(String) },
    });
    const [row] = await query<{ state: string; village_code: string; fields: { states: { place: unknown } } }>`
      select state, village_code, fields from report_draft where id = ${draft.draftId}`;
    expect(row).toMatchObject({
      state: "neighbourhood",
      village_code: POSTER,
      fields: { states: { place: { state: "value", origin: "system", value: { villageCode: POSTER } } } },
    });
  });

  test("a village the place data has not starts at the place question; a code of the wrong shape is refused", async () => {
    const unknown = await browser(fetchApi).call("POST", "/consent", consent({ villageCode: "99.99.99.9999" }));
    expect(unknown.draft.card.kind).toBe("placeSearch");
    expect((await browser(fetchApi).call("POST", "/consent", consent({ villageCode: "1108032031" }))).status).toBe(400);
  });

  test("a known reporter and an emergency start from the poster's village too", async () => {
    const phone = browser(fetchApi);
    await startDraft(phone, freshNumber().typed);
    const me = (await phone.call("GET", "/me")).json as { knownReporters: { profileId: string }[] };
    const started = await phone.call("POST", "/drafts", {
      profileId: me.knownReporters[0]?.profileId,
      replaceOpenDraft: true,
      emergency: true,
      villageCode: POSTER,
    });
    expect(started.status).toBe(201);
    expect((started.json as DraftBody).card).toMatchObject({ titleKey: "card.emergency.type.title" });
  });
});
