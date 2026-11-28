import { beforeAll, describe, expect, test } from "vitest";
import type { Card } from "../../contract/card";
import type { DraftBody } from "../../contract/draft";
import { PRIVACY } from "../../domain/privacy";
import { browser, freshNumber, manualClock, query, testBindings } from "../../testing/api";
import { turn, walkTo } from "../../testing/walk";
import { api } from "../app";

const clock = manualClock("2026-11-23T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchApi = (request: Request) => api.app.fetch(request, bindings);
const tick = () => clock.advance(4000);

let village = "";
beforeAll(async () => {
  const [first] = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active
    where v.search_text like '%sukamaju%' order by v.code limit 1`;
  village = (first as { code: string }).code;
});

async function start() {
  const phone = browser(fetchApi);
  const answer = await phone.call("POST", "/consent", {
    role: "citizen",
    name: "Uji Satu",
    number: freshNumber().typed,
    privacyVersion: PRIVACY.version,
    agree: true,
  });
  return { phone, draft: answer.draft };
}

const isCard = (kind: string, fieldId?: string) => (draft: DraftBody) =>
  draft.card.kind === kind &&
  (fieldId === undefined ||
    ("fieldId" in draft.card && draft.card.fieldId === fieldId) ||
    ("groupId" in draft.card && draft.card.groupId === fieldId));
const post = (phone: ReturnType<typeof browser>, draft: DraftBody, body: Record<string, unknown>) =>
  phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(draft, body));
const rows = (card: Card) => (card.kind === "summary" ? card.groups.flatMap((group) => group.rows) : []);
const row = (card: Card, fieldId: string) => rows(card).find((entry) => entry.fieldId === fieldId);

async function storedFields(draftId: string) {
  const [stored] = await query<{
    fields: { states: Record<string, unknown> } | null;
  }>`select fields from report_draft where id = ${draftId}`;
  return stored?.fields?.states ?? null;
}

describe("revision and turn key", () => {
  test("an older tab is refused saying the draft changed and is shown the current card", async () => {
    const { phone, draft } = await start();
    const moved = await post(phone, draft, { villageCode: village });
    const stale = await post(phone, draft, { villageCode: village });
    expect(stale.status).toBe(409);
    expect(stale.error.error.code).toBe("draft.changed");
    expect(stale.error.draft?.card.kind).toBe("neighbourhood");
    expect(stale.error.draft?.revision).toBe(moved.draft.revision);
  });

  test("two turns at once on one revision: one is stored, the other is told the draft changed", async () => {
    const { phone, draft } = await start();
    const answers = await Promise.all([
      post(phone, draft, { villageCode: village }),
      post(phone, draft, { villageCode: village }),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    const [stored] = await query<{ revision: number }>`select revision from report_draft where id = ${draft.draftId}`;
    expect(stored?.revision).toBe(draft.revision + 1);
  });

  test("the same key and body replays the stored reply; the same key with another body is refused", async () => {
    const { phone, draft } = await start();
    const body = turn(draft, { villageCode: village });
    const first = await phone.call("POST", `/drafts/${draft.draftId}/turns`, body);
    const again = await phone.call("POST", `/drafts/${draft.draftId}/turns`, body);
    expect(again.status).toBe(200);
    expect(again.json).toEqual(first.json);
    const other = await phone.call("POST", `/drafts/${draft.draftId}/turns`, { ...body, villageCode: "11.08.01.2099" });
    expect(other.status).toBe(422);
    expect(other.error.error.code).toBe("turn.keyReused");
  });

  test("an option the card does not hold, or an answer to an old card id, is told the draft changed", async () => {
    const { phone, draft } = await start();
    const { draft: hazard } = await walkTo(phone, draft, village, { tick, stopAt: isCard("choice", "hazardType") });
    expect((await post(phone, hazard, { optionIds: ["rahasia"] })).status).toBe(409);
    expect((await post(phone, hazard, { optionIds: ["flood"], cardId: "c-0" })).status).toBe(409);
  });
});

describe("kembali", () => {
  test("at the subtype after Banjir it shows the hazard type question again with no type stored", async () => {
    const { phone, draft } = await start();
    const { draft: hazard } = await walkTo(phone, draft, village, { tick, stopAt: isCard("choice", "hazardType") });
    const subtype = await post(phone, hazard, { optionIds: ["flood"] });
    expect(subtype.draft.card.kind === "choice" && subtype.draft.card.fieldId).toBe("hazardSubtype");
    const back = await post(phone, subtype.draft, { kind: "freeText", text: "kembali" });
    expect(back.draft.card.kind === "choice" && back.draft.card.fieldId).toBe("hazardType");
    expect((await storedFields(draft.draftId))?.hazardType).toBeUndefined();
  });

  test("with no answer yet it says there is nothing to undo", async () => {
    const { phone, draft } = await start();
    const back = await post(phone, draft, { kind: "back" });
    expect(back.status).toBe(422);
    expect(back.error.error).toEqual({ code: "draft.nothingToUndo", copyKey: "error.draft.nothingToUndo", params: {} });
    expect(back.error.draft?.card.kind).toBe("placeSearch");
  });

  test("goes back 12 steps at most, then says the limit", async () => {
    const { phone, draft } = await start();
    const { draft: far } = await walkTo(phone, draft, village, { tick, stopAt: isCard("numberForm", "victims") });
    let current = far;
    for (let step = 0; step < 12; step += 1) {
      tick();
      const back = await post(phone, current, { kind: "back" });
      expect(back.status).toBe(200);
      current = back.draft;
    }
    tick();
    const limit = await post(phone, current, { kind: "back" });
    expect(limit.error.error.code).toBe("draft.backLimit");
  });
});

describe("Batal", () => {
  test("asks a confirm; its way back, or typed kembali, closes it with every answer unchanged", async () => {
    const { phone, draft } = await start();
    const { draft: summary } = await walkTo(phone, draft, village, { tick });
    const before = await storedFields(draft.draftId);
    const confirm = await post(phone, summary, { kind: "cancel" });
    expect(confirm.draft.card).toMatchObject({
      kind: "confirm",
      confirmId: "cancelDraft",
      titleKey: "card.confirm.cancelDraft.title",
    });
    const dismissed = await post(phone, confirm.draft, { kind: "dismiss" });
    expect(dismissed.draft.card.kind).toBe("summary");
    const typed = await post(phone, dismissed.draft, { kind: "freeText", text: "batal" });
    expect(typed.draft.card.kind).toBe("confirm");
    const closed = await post(phone, typed.draft, { kind: "freeText", text: "Kembali" });
    expect(closed.draft.card.kind).toBe("summary");
    expect(await storedFields(draft.draftId)).toEqual(before);
  });

  test("confirmed, it ends the draft and no row holds its answers or transcript", async () => {
    const { phone, draft } = await start();
    const { draft: summary } = await walkTo(phone, draft, village, { tick });
    const confirm = await post(phone, summary, { kind: "cancel" });
    const cancelled = await post(phone, confirm.draft, { kind: "confirm" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.draft.card.kind).toBe("cancelled");
    expect(cancelled.draft.transcript).toEqual([]);
    const [left] = await query<{
      state: string;
      fields: unknown;
      back_stack: unknown;
      messages: number;
      replies: number;
    }>`
      select state, fields, back_stack, (select count(*) from draft_message where draft_id = ${draft.draftId}) as messages,
        (select count(*) from turn_reply where draft_id = ${draft.draftId}) as replies
      from report_draft where id = ${draft.draftId}`;
    expect(left).toEqual({ state: "cancelled", fields: null, back_stack: null, messages: 0, replies: 0 });
    expect((await post(phone, summary, { kind: "confirm" })).draft.card.kind).toBe("cancelled");
  });

  test("a confirm with no cancel card open, or a dismiss with nothing open, is stale", async () => {
    const { phone, draft } = await start();
    expect((await post(phone, draft, { kind: "confirm" })).status).toBe(409);
    expect((await post(phone, draft, { kind: "dismiss" })).status).toBe(409);
    expect((await post(phone, draft, { kind: "editGroup", groupId: "victims" })).status).toBe(409);
  });
});

describe("number forms", () => {
  test("a 0 is a none, a box left empty twice is not known, and no 0 is stored for it", async () => {
    const { phone, draft } = await start();
    const victims = isCard("numberForm", "victims");
    const { draft: form } = await walkTo(phone, draft, village, { tick, stopAt: victims });
    const once = await post(phone, form, { values: { dead: "0", missing: "", injured: "" } });
    const { draft: again } = await walkTo(phone, once.draft, village, { tick, stopAt: victims });
    expect(again.card.kind === "numberForm" && again.card.fields.map((field) => [field.id, field.askedBefore])).toEqual(
      [
        ["missing", true],
        ["injured", true],
      ],
    );
    const twice = await post(phone, again, { values: { missing: "", injured: "4" } });
    const { draft: summary } = await walkTo(phone, twice.draft, village, { tick });
    expect(row(summary.card, "dead")).toMatchObject({ state: "none", value: null, origin: "boxEntry" });
    expect(row(summary.card, "missing")).toMatchObject({ state: "confirmedUnknown", value: null, origin: "boxEntry" });
    expect(row(summary.card, "injured")).toMatchObject({ state: "value", value: { kind: "count", count: 4 } });
    const states = await storedFields(draft.draftId);
    expect(states?.missing).toEqual({ state: "confirmedUnknown", origin: "boxEntry" });
  });

  test("a box saying ada is refused asking for the number, and nothing is stored", async () => {
    const { phone, draft } = await start();
    const { draft: form } = await walkTo(phone, draft, village, { tick, stopAt: isCard("numberForm", "victims") });
    const refused = await post(phone, form, { values: { dead: "ada", missing: "2" } });
    expect(refused.status).toBe(422);
    expect(refused.error.fields).toEqual([
      { fieldId: "dead", copyKey: "fieldError.countNeeded", params: { label: "field.dead.label", max: 100_000 } },
    ]);
    expect((await storedFields(draft.draftId))?.missing).toBeUndefined();
  });

  test("Ubah on the victims group reopens it and saving returns to the summary with the others unchanged", async () => {
    const { phone, draft } = await start();
    const { draft: summary } = await walkTo(phone, draft, village, { tick });
    const others = (card: Card) =>
      card.kind === "summary" ? card.groups.filter((group) => group.groupId !== "victims") : [];
    const before = others(summary.card);
    const edit = await post(phone, summary, { kind: "editGroup", groupId: "victims" });
    expect(
      edit.draft.card.kind === "numberForm" && edit.draft.card.fields.map((field) => [field.id, field.value]),
    ).toEqual([
      ["dead", 0],
      ["missing", 0],
      ["injured", 0],
    ]);
    const saved = await post(phone, edit.draft, { values: { dead: "0", missing: "2", injured: "0" } });
    expect(saved.draft.card.kind).toBe("summary");
    expect(row(saved.draft.card, "missing")?.value).toEqual({ kind: "count", count: 2 });
    expect(others(saved.draft.card)).toEqual(before);
  });

  test("Ubah on houses and typed words correct a value", async () => {
    const { phone, draft } = await start();
    const { draft: summary } = await walkTo(phone, draft, village, { tick });
    const edit = await post(phone, summary, { kind: "editGroup", groupId: "houses" });
    const typed = await post(phone, edit.draft, { kind: "freeText", text: "rusak berat 5" });
    expect(typed.draft.card.kind).toBe("summary");
    expect(row(typed.draft.card, "housesHeavy")).toMatchObject({
      state: "value",
      value: { kind: "count", count: 5 },
      origin: "quote",
    });
  });

  test("an exclusive option with others is refused naming both, and nothing is stored", async () => {
    const { phone, draft } = await start();
    const { draft: groups } = await walkTo(phone, draft, village, {
      tick,
      stopAt: isCard("multiChoice", "vulnerableGroups"),
    });
    const refused = await post(phone, groups, { optionIds: ["elderly", "none"] });
    expect(refused.status).toBe(422);
    expect(refused.error.fields).toEqual([
      {
        fieldId: "vulnerableGroups",
        copyKey: "fieldError.exclusiveWithOthers",
        params: { label: "field.vulnerableGroups.label", option: "option.vulnerableGroups.none.label" },
      },
    ]);
  });
});

describe("event time", () => {
  const timeCard = isCard("timeCard");
  test("exactly 10 minutes ahead and 30 days back pass; 11 minutes ahead and 30 days and 1 minute back are refused at the date", async () => {
    const { phone, draft } = await start();
    const { draft: card } = await walkTo(phone, draft, village, { tick, stopAt: timeCard });
    const now = clock.now();
    const local = (ms: number) => new Date(ms + 7 * 3_600_000).toISOString();
    const at = (ms: number) => ({
      optionIds: ["otherDate"],
      values: { date: local(ms).slice(0, 10), hour: local(ms).slice(11, 16) },
    });
    const minute = 60_000;
    const ahead = await post(phone, card, at(now + 11 * minute));
    expect(ahead.error.fields).toEqual([
      { fieldId: "date", copyKey: "fieldError.time.inFuture", params: { label: "card.timeCard.date" } },
    ]);
    const old = await post(phone, card, at(now - 30 * 86_400_000 - minute - 60_000));
    expect(old.error.fields?.[0]?.copyKey).toBe("fieldError.time.tooOld");
    const backed = await post(phone, card, at(now - 30 * 86_400_000 + minute));
    expect(backed.status).toBe(200);
    const back = await post(phone, backed.draft, { kind: "back" });
    expect((await post(phone, back.draft, at(now + 10 * minute - (now % minute)))).status).toBe(200);
  });

  test("Hari ini with Tidak tahu jamnya stores the date only; older than 30 days is stored as that choice", async () => {
    const { phone, draft } = await start();
    const { draft: card } = await walkTo(phone, draft, village, { tick, stopAt: timeCard });
    const dateOnly = await post(phone, card, { optionIds: ["today", "hourUnknown"], values: { hour: "09.00" } });
    expect((await storedFields(draft.draftId))?.eventTime).toEqual({
      state: "value",
      value: { kind: "dateOnly", localDate: "2026-11-23", zone: "WIB" },
      origin: "tappedOption",
    });
    const back = await post(phone, dateOnly.draft, { kind: "back" });
    await post(phone, back.draft, { optionIds: ["olderThan30Days"], values: { date: "2026-01-01" } });
    expect((await storedFields(draft.draftId))?.eventTime).toEqual({
      state: "value",
      value: { kind: "olderThan30Days" },
      origin: "tappedOption",
    });
  });

  test("no date picked, or an hour that cannot be read, is refused at that field", async () => {
    const { phone, draft } = await start();
    const { draft: card } = await walkTo(phone, draft, village, { tick, stopAt: timeCard });
    expect(
      (await post(phone, card, { optionIds: ["otherDate"], values: { date: "" } })).error.fields?.[0]?.copyKey,
    ).toBe("fieldError.time.dateRequired");
    expect(
      (await post(phone, card, { optionIds: ["today"], values: { hour: "25.00" } })).error.fields?.[0],
    ).toMatchObject({ fieldId: "hour", copyKey: "fieldError.time.hourFormat" });
  });
});

describe("notices after the redirect", () => {
  const codes = (draft: DraftBody) => draft.notices.map((notice) => notice.copyKey);

  test("a new draft's first read shows the 112 line once; coming back later adds the resumed signal", async () => {
    const { phone, draft } = await start();
    expect(codes((await phone.call("GET", `/drafts/${draft.draftId}`)).draft)).toEqual(["notice.lifeLine"]);
    expect(codes((await phone.call("GET", `/drafts/${draft.draftId}`)).draft)).toEqual([
      "notice.lifeLine",
      "notice.resumed",
    ]);
  });

  test("the danger warning of a dangerous option is shown by the next read, once", async () => {
    const { phone, draft } = await start();
    const dangerous = (body: DraftBody) =>
      body.card.kind === "chronologyStep" && body.card.options.some((option) => option.danger);
    const { draft: step } = await walkTo(phone, draft, village, { tick, stopAt: dangerous });
    const option = step.card.kind === "chronologyStep" ? step.card.options.find((entry) => entry.danger) : undefined;
    tick();
    const answered = await post(phone, step, { optionIds: [option?.id] });
    expect(answered.status).toBe(200);
    const warning = answered.draft.notices.find((notice) => notice.kind === "danger");
    expect(warning?.copyKey).toMatch(/^chronology\..+\.warning$/);
    const first = (await phone.call("GET", `/drafts/${draft.draftId}`)).draft;
    expect(first.notices.filter((notice) => notice.kind === "danger")).toEqual([warning]);
    const again = (await phone.call("GET", `/drafts/${draft.draftId}`)).draft;
    expect(again.notices.some((notice) => notice.kind === "danger")).toBe(false);
  });

  test("the summary's 112 line comes with the read after the last answer", async () => {
    const { phone, draft } = await start();
    await walkTo(phone, draft, village, { tick });
    expect(codes((await phone.call("GET", `/drafts/${draft.draftId}`)).draft)).toEqual(["notice.lifeLine"]);
  });
});

describe("the history", () => {
  type Line = DraftBody["transcript"][number];
  const cardLines = (lines: readonly Line[]) =>
    lines.map((line, index) => ({ line, index })).filter(({ line }) => line.speaker === "assistant" && line.cardKind);

  test("a guided step's line keeps its question beside its progress heading", async () => {
    const { phone, draft } = await start();
    const { draft: step } = await walkTo(phone, draft, village, { tick, stopAt: isCard("chronologyStep") });
    tick();
    const answered = await post(phone, step, {
      optionIds: [step.card.kind === "chronologyStep" ? step.card.options[0]?.id : ""],
    });
    const guided = answered.draft.transcript.filter(
      (line) => line.speaker === "assistant" && line.cardKind === "chronologyStep",
    );
    expect(guided.length).toBeGreaterThan(1);
    for (const line of guided)
      expect(line.speaker === "assistant" && line).toMatchObject({
        copyKey: "card.chronologyStep.progress",
        promptKey: expect.stringMatching(/^chronology\.[a-zA-Z]+\.step\d+\.question$/),
      });
  });

  test("after several kembali every question but the live one still has its answer", async () => {
    const { phone, draft } = await start();
    let { draft: current } = await walkTo(phone, draft, village, { tick, stopAt: isCard("chronologyStep") });
    const before = current.transcript.length;
    for (let undo = 0; undo < 3; undo += 1) {
      tick();
      const back = await post(phone, current, { kind: "back" });
      expect(back.status).toBe(200);
      current = back.draft;
    }
    tick();
    const typed = await post(phone, current, { kind: "freeText", text: "kembali" });
    expect(typed.status).toBe(200);
    const lines = typed.draft.transcript;
    expect(lines.length).toBeLessThan(before);
    const questions = cardLines(lines);
    for (const { index } of questions.slice(0, -1)) expect(lines[index + 1]?.speaker).toBe("reporter");
    expect(questions.at(-1)?.index).toBe(lines.length - 1);
    expect(questions.at(-1)?.line).toMatchObject({ cardKind: typed.draft.card.kind });
  });
});

describe("the history of a step stored before it was marked", () => {
  test("going back over it keeps its lines and adds the restored question", async () => {
    const { phone, draft } = await start();
    const { draft: current } = await walkTo(phone, draft, village, { tick, stopAt: isCard("choice", "hazardType") });
    await query`update report_draft set back_stack = (
      select coalesce(jsonb_agg(entry.value - 'transcriptSeq' order by entry.n), '[]') from jsonb_array_elements(back_stack) with ordinality as entry (value, n))
      where id = ${draft.draftId}`;
    tick();
    const back = await post(phone, current, { kind: "back" });
    expect(back.status).toBe(200);
    expect(back.draft.transcript.length).toBe(current.transcript.length + 1);
  });
});
