import { beforeAll, describe, expect, test } from "vitest";
import type { Card } from "../../contract/card";
import { draftBodySchema } from "../../contract/draft";
import { browser, freshNumber, manualClock, query, testBindings } from "../../testing/api";
import { turn, walkTo } from "../../testing/walk";
import { api } from "../app";

const clock = manualClock("2026-11-23T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchApi = (request: Request) => api.app.fetch(request, bindings);

let village = "";
let witVillage = "";
beforeAll(async () => {
  const [first] = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active
    where v.search_text like '%sukamaju%' order by v.code limit 1`;
  const [east] = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active
    where v.province_code = '81' order by v.code limit 1`;
  village = (first as { code: string }).code;
  witVillage = (east as { code: string }).code;
});

async function start(name = "Uji Satu") {
  const phone = browser(fetchApi);
  const answer = await phone.call("POST", "/consent", {
    role: "citizen",
    name,
    number: freshNumber().typed,
    privacyVersion: 1,
    agree: true,
  });
  return { phone, draft: answer.draft };
}

const tick = () => clock.advance(4000);
const rows = (card: Card) => (card.kind === "summary" ? card.groups.flatMap((group) => group.rows) : []);

describe("a report with the model off", () => {
  test("every card in turn, by the default answers, reaches the summary with every field settled", async () => {
    const { phone, draft } = await start();
    const { draft: summary, turns } = await walkTo(phone, draft, village, { tick });
    expect(draftBodySchema.parse(summary).state).toBe("summary");
    expect(turns).toBeGreaterThan(15);
    expect(summary.card.kind).toBe("summary");
    expect(summary.completePercent).toBe(100);
    expect(summary.notices.map((notice) => notice.copyKey)).toEqual(["notice.lifeLine"]);
    const states = Object.fromEntries(rows(summary.card).map((row) => [row.fieldId, row.state]));
    expect(states).toMatchObject({
      place: "value",
      neighbourhood: "confirmedUnknown",
      hazardType: "value",
      dead: "none",
    });
    expect(Object.keys(states)).not.toContain("injuredInpatient");
    expect(summary.card.kind === "summary" && summary.card.reporter).toEqual({ name: "Uji Satu", role: "citizen" });
  });

  test("the draft body validates against the contract at every card", async () => {
    const { phone, draft } = await start();
    const seen: string[] = [];
    await walkTo(phone, draft, village, {
      tick,
      stopAt: (current) => {
        draftBodySchema.parse(current);
        seen.push(current.card.kind);
        return current.card.kind === "summary";
      },
    });
    expect(new Set(seen)).toEqual(
      new Set([
        "placeSearch",
        "neighbourhood",
        "choice",
        "chronologyStep",
        "chronologyReview",
        "timeCard",
        "numberForm",
        "multiChoice",
        "photos",
        "summary",
      ]),
    );
  });

  test("a place in a WIT province shows its time in WIT", async () => {
    const { phone, draft } = await start();
    const { draft: atTime } = await walkTo(phone, draft, witVillage, {
      tick,
      stopAt: (current) => current.card.kind === "timeCard",
    });
    expect(atTime.card.kind === "timeCard" && atTime.card.zone).toBe("WIT");
    const answer = await phone.call(
      "POST",
      `/drafts/${atTime.draftId}/turns`,
      turn(atTime, { optionIds: ["today"], values: { hour: "10.00" } }),
    );
    expect(answer.status).toBe(200);
    const { draft: summary } = await walkTo(phone, answer.draft, witVillage, { tick });
    const time = rows(summary.card).find((row) => row.fieldId === "eventTime");
    expect(time?.value).toEqual({
      kind: "eventTime",
      time: { kind: "dateTime", localDate: "2026-11-23", localTime: "10:00", zone: "WIT" },
    });
    expect(summary.keptUntil.zone).toBe("WIT");
  });
});
