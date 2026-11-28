import { beforeAll, describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import type { DraftBody } from "../../contract/draft";
import { browser, freshNumber, manualClock, query, testBindings, testDatabase } from "../../testing/api";
import { sendDraft, startDraft, turn, walkTo } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

vi.setConfig({ testTimeout: 120_000 });

const clock = manualClock("2026-11-24T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchApi = (request: Request) =>
  api.app.fetch(request, { ...bindings, db: testDatabase() } satisfies ApiBindings);
const tick = () => clock.advance(4000);
const HOUR = 3_600_000;

const desk = () => {
  const phone = browser(fetchApi);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[2] as { token: string }).token);
  return phone;
};

// Each test reports in a district of its own, so reports of another test are never offered.
const villages: string[] = [];
beforeAll(async () => {
  const found = await query<{ code: string }>`
    select min(v.code) as code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active
    group by v.district_name, v.regency_code order by 1 limit 4`;
  villages.push(...found.map((one) => one.code));
});

const sentReport = async (village: string, text: string) => {
  const phone = browser(fetchApi);
  const started = await startDraft(phone, freshNumber().typed, "Uji Rahasia");
  const told = await phone.call("POST", `/drafts/${started.draftId}/turns`, turn(started, { kind: "freeText", text }));
  return sendDraft(phone, told.draft, village, { tick });
};

// A new reporter up to the card after the neighbourhood.
const reachOffer = async (village: string, story: string | null = null) => {
  const phone = browser(fetchApi);
  const fresh = await startDraft(phone, freshNumber().typed, "Uji Dua");
  const started =
    story === null
      ? fresh
      : (await phone.call("POST", `/drafts/${fresh.draftId}/turns`, turn(fresh, { kind: "freeText", text: story })))
          .draft;
  const { draft } = await walkTo(phone, started, village, {
    tick,
    stopAt: (one: DraftBody) => one.card.kind !== "placeSearch" && one.card.kind !== "neighbourhood",
  });
  return { phone, draft };
};
const answer = (phone: ReturnType<typeof browser>, draft: DraftBody, optionIds: string[]) =>
  phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(draft, { optionIds }));

describe("the same event", () => {
  test("a report nearby is offered with no one named; yes takes its kind and joins its cluster", async () => {
    const village = villages[0] as string;
    const first = await sentReport(village, "banjir");
    clock.advance(HOUR);
    const { phone, draft } = await reachOffer(village);
    expect(draft.card).toMatchObject({ kind: "choice", fieldId: "sameEvent", titleKey: "card.sameEvent.title" });
    const card = draft.card as { options: { id: string }[]; params: Record<string, string> };
    expect(card.options.map((option) => option.id)).toEqual(["flood", "none"]);
    expect(card.params.offers).toMatch(/^banjir sejak \d+ November 2026, \d{2}\.\d{2} WIB dari 1 warga$/);
    expect(JSON.stringify(draft)).not.toContain(first);
    expect(JSON.stringify(draft)).not.toContain("Uji Rahasia");

    expect((await answer(phone, draft, ["landslide"])).status).toBe(409);
    const joined = await answer(phone, draft, ["flood"]);
    expect(joined.status).toBe(200);
    expect(joined.draft.card).not.toMatchObject({ fieldId: "hazardType" });
    const { draft: summary } = await walkTo(phone, joined.draft, village, { tick });
    const sent = await phone.call("POST", `/drafts/${summary.draftId}/send`, {
      revision: summary.revision,
      turnKey: crypto.randomUUID(),
    });
    const second = (sent.json as { ticketNumber: string }).ticketNumber;
    expect(await query`select same_as from report_link where ticket_number = ${second}`).toEqual([{ same_as: first }]);
    const report = (await desk().call("GET", `/desk/reports/${second}`)).json as {
      hazardType: string;
      cluster: unknown;
      event: unknown;
    };
    expect(report).toMatchObject({ hazardType: "flood", cluster: { tickets: [first, second], reporters: 2 } });

    // The two are one event by its code, from the first report's day; BNPB may take one out.
    const code = `KJ-${first.slice(3, 9)}-01`;
    expect(report.event).toEqual({ code, tickets: [first, second], mayRelease: true });
    const regional = browser(fetchApi);
    regional.cookies.set("seeded_session", (SEEDED_SESSIONS[3] as { token: string }).token);
    expect((await regional.call("POST", `/desk/reports/${second}/event/release`)).status).toBe(403);
    const released = await desk().call("POST", `/desk/reports/${second}/event/release`);
    expect(released.status).toBe(200);
    const after = released.json as { event: unknown; history: { event: string | null; detail: unknown }[] };
    expect(after.event).toBeNull();
    expect(after.history.at(-1)).toMatchObject({ event: "released", detail: { code } });
    // An event of one report is no event.
    expect(((await desk().call("GET", `/desk/reports/${first}`)).json as { event: unknown }).event).toBeNull();
    expect(await query`select 1 from report_link where ticket_number = ${second}`).toEqual([]);
    expect((await desk().call("POST", `/desk/reports/${second}/event/release`)).status).toBe(404);
  });

  test("no is a report of its own; drought joins only when its reporter says so", async () => {
    const village = villages[1] as string;
    await sentReport(village, "kekeringan");
    const { phone, draft } = await reachOffer(village);
    expect((draft.card as { options: { id: string }[] }).options.map((option) => option.id)).toEqual([
      "drought",
      "none",
    ]);
    const own = await answer(phone, draft, ["none"]);
    expect(own.draft.card).toMatchObject({ fieldId: "hazardType" });
    // A story told first is offered the same.
    expect((await reachOffer(village, "kemarau panjang")).draft.card).toMatchObject({ fieldId: "sameEvent" });
  });

  test("nothing is offered past its hazard's window, or for a report set aside", async () => {
    const village = villages[2] as string;
    const old = await sentReport(village, "banjir");
    clock.advance(7 * HOUR);
    expect((await reachOffer(village)).draft.card).toMatchObject({ fieldId: "hazardType" });
    const closed = await sentReport(village, "banjir");
    await desk().call("POST", `/desk/reports/${closed}/view`);
    const { revision } = (await desk().call("GET", `/desk/reports/${closed}`)).json as { revision: number };
    const moved = await desk().call("POST", `/desk/reports/${closed}/status`, {
      to: "invalid",
      note: "Laporan uji coba",
      revision,
    });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    expect((await reachOffer(village)).draft.card).toMatchObject({ fieldId: "hazardType" });
    expect(old).not.toBe(closed);
  });
});
