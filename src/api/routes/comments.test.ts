import { beforeAll, describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { commentsSchema } from "../../contract/comments";
import { type DeskReport, deskReportSchema } from "../../contract/desk";
import { feedSchema } from "../../contract/publicFeed";
import { windowStart } from "../../domain/limits";
import { addressBucket } from "../../platform/address";
import { hmacKey } from "../../platform/keys";
import type { ModelPort } from "../../ports/model";
import { browser, freshAddress, freshNumber, manualClock, query, testBindings, testDatabase } from "../../testing/api";
import { sendDraft, startDraft, turn } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

vi.setConfig({ testTimeout: 90_000 });

const clock = manualClock("2026-11-24T03:00:00.000Z");
// The model reads each comment's figures as the test sets them.
const answers = new Map<string, unknown>();
const model: ModelPort = {
  async extract(request) {
    const said = /<comment>\n([\s\S]*)\n<\/comment>/.exec(request.user)?.[1] as string;
    if (answers.get(said) === "fail") throw new Error("model down");
    if (answers.get(said) === "slow") return new Promise(() => undefined);
    return answers.get(said) ?? null;
  },
};
const { bindings } = testBindings(
  { MODEL_MODE: "recorded", MODEL_BASE_URL: "http://localhost:8790", MODEL_NAME: "recorded" },
  { clock, model },
);
const quiet = testBindings({}, { clock }).bindings;
const fetchWith = (with_: ApiBindings) => (request: Request) =>
  api.app.fetch(request, { ...with_, db: testDatabase() } satisfies ApiBindings);
const fetchApi = fetchWith(bindings);
const tick = () => clock.advance(4000);

type Phone = ReturnType<typeof browser>;
const staff = (index: number) => {
  const phone = browser(fetchApi);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[index] as { token: string }).token);
  return phone;
};
const DESK = 2;
const REGENCY = 3;
const PROVINCE = 4;

let village = "";
let sumut = "";
beforeAll(async () => {
  const first = async (regency: string) =>
    (
      await query<{ code: string }>`
        select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active = 1
        where v.regency_code like ${regency} order by v.code limit 1`
    )[0]?.code as string;
  [village, sumut] = await Promise.all([first("11.08"), first("12.%")]);
});

// A known reporter: one who has sent a report from this phone.
const reporter = async (address = freshAddress()) => {
  const phone = browser(fetchApi, address);
  await startDraft(phone, freshNumber().typed);
  return phone;
};
const read = async (ticket: string): Promise<DeskReport> =>
  deskReportSchema.parse((await staff(DESK).call("GET", `/desk/reports/${ticket}`)).json);
// A flood the desk is handling, shown on the Alun-alun as a card; answers its ticket, card and author.
// A day apart, so each falls in an event, and on a card, of its own.
const handled = async (text = "banjir, tiga orang meninggal", at = village) => {
  clock.advance(25 * 3_600_000);
  const phone = browser(fetchApi);
  const started = await startDraft(phone, freshNumber().typed);
  const told = await phone.call("POST", `/drafts/${started.draftId}/turns`, turn(started, { kind: "freeText", text }));
  const ticket = await sendDraft(phone, told.draft, at, { tick });
  await staff(DESK).call("POST", `/desk/reports/${ticket}/view`);
  for (const [to, extra] of [
    ["under_review", {}],
    ["in_handling", { actions: ["evakuasi"] }],
  ] as const) {
    tick();
    const moved = await staff(DESK).call("POST", `/desk/reports/${ticket}/status`, {
      to,
      note: "",
      revision: (await read(ticket)).revision,
      ...extra,
    });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
  }
  clock.advance(61_000);
  const feed = feedSchema.parse((await browser(fetchApi).call("GET", "/feed")).json);
  const card = feed.entries[0]?.id as string;
  return { ticket, card, author: phone };
};
const comment = (phone: Phone, card: string, text: string) =>
  phone.call("POST", `/feed/cards/${card}/comments`, { text });
const shown = async (card: string) =>
  commentsSchema.parse((await browser(fetchApi).call("GET", `/feed/cards/${card}/comments`)).json).comments;
const report = (phone: Phone, id: string) => phone.call("POST", `/feed/comments/${id}/report`);
const decide = async (ticket: string, path: string, body: object, index = DESK) => {
  tick();
  return staff(index).call("POST", `/desk/reports/${ticket}/${path}`, body);
};
const limitKey = async (phone: Phone) =>
  hmacKey(bindings.settings.keyHmacSecret, "address", addressBucket(phone.address) as string);

describe("a comment on a card", () => {
  test("from a known reporter is shown to all as its words and minute, contacts taken out", async () => {
    const { card, author } = await handled();
    clock.advance(17_000);
    const posted = await comment(author, card, "Air surut, hubungi 0812-3456-7890 di RT 03");
    expect(posted.status, JSON.stringify(posted.json)).toBe(201);
    expect(posted.json).toMatchObject({ comment: { text: "Air surut, hubungi [nomor dihapus] di [RT/RW dihapus]" } });
    const [first] = await shown(card);
    expect(first).toEqual({
      id: (posted.json as { comment: { id: string } }).comment.id,
      text: "Air surut, hubungi [nomor dihapus] di [RT/RW dihapus]",
      at: { utc: new Date(Math.floor(clock.now() / 60_000) * 60_000).toISOString(), zone: "WIB" },
    });
  });

  test("is refused to a stranger, on a card not shown, and when empty or rude", async () => {
    const { card, author } = await handled();
    expect((await comment(browser(fetchApi), card, "halo")).status).toBe(401);
    // A session whose person has agreed to nothing here yet.
    const unknown = await comment(staff(0), card, "halo");
    expect([unknown.status, unknown.error.error.code]).toEqual([403, "comments.unknownReporter"]);
    const gone = await comment(author, "0123456789abcdef", "halo");
    expect([gone.status, gone.error.error.code]).toEqual([404, "comments.notShown"]);
    const rude = await comment(author, card, "dasar goblok");
    expect(rude.status).toBe(422);
    expect(rude.error.fields).toEqual([
      expect.objectContaining({ fieldId: "text", copyKey: "fieldError.comment.rude" }),
    ]);
    const session = staff(1);
    await startDraft(session, freshNumber().typed);
    expect((await comment(session, card, "Warga sudah dievakuasi")).status).toBe(201);
  });

  test("is limited per network and per number", async () => {
    const { card, author } = await handled();
    for (let n = 0; n < 10; n += 1) expect((await comment(author, card, `kabar ke ${n + 1}`)).status).toBe(201);
    const tenth = await comment(author, card, "kabar lagi");
    expect([tenth.status, tenth.error.error.code]).toEqual([429, "limit.comment.hour"]);
    const crowded = await reporter();
    await query`insert into rate_counter (limit_id, subject_key, window_start, count)
      values ('address.comments', ${await limitKey(crowded)}, ${new Date(windowStart("clockHour", clock.now()))}, 30)`;
    const refused = await comment(crowded, card, "halo");
    expect([refused.status, refused.error.error.code]).toEqual([429, "limit.address.comments"]);
  });
});

describe("a comment reported", () => {
  test("by three people leaves the card; its author cannot, and one person counts once", async () => {
    const { card, author } = await handled();
    const id = ((await comment(author, card, "bohong itu")).json as { comment: { id: string } }).comment.id;
    const own = await report(author, id);
    expect([own.status, own.error.error.code]).toEqual([400, "comments.own"]);
    const first = await reporter();
    expect((await report(first, id)).json).toEqual({ counted: true });
    expect((await report(first, id)).json).toEqual({ counted: false });
    // Another number typed on the same network is the same person.
    expect((await report(await reporter(first.address), id)).json).toEqual({ counted: false });
    const session = staff(1);
    await startDraft(session, freshNumber().typed);
    expect((await report(session, id)).json).toEqual({ counted: true });
    expect(await shown(card)).toHaveLength(1);
    expect((await report(await reporter(), id)).json).toEqual({ counted: true });
    expect(await shown(card)).toEqual([]);
    const gone = await report(await reporter(), id);
    expect([gone.status, gone.error.error.code]).toEqual([404, "comments.notFound"]);
    expect((await report(staff(0), id)).status).toBe(403);
  });

  test("is limited per network and per number", async () => {
    const { card, author } = await handled();
    const id = ((await comment(author, card, "kabar")).json as { comment: { id: string } }).comment.id;
    const one = await reporter();
    for (let n = 0; n < 20; n += 1) expect((await report(one, id)).status).toBe(200);
    const many = await report(one, id);
    expect([many.status, many.error.error.code]).toEqual([429, "limit.comment.reports"]);
    const crowded = await reporter();
    await query`insert into rate_counter (limit_id, subject_key, window_start, count)
      values ('address.commentReports', ${await limitKey(crowded)}, ${new Date(windowStart("clockHour", clock.now()))}, 30)`;
    const refused = await report(crowded, id);
    expect([refused.status, refused.error.error.code]).toEqual([429, "limit.address.commentReports"]);
  });
});

describe("the desk", () => {
  test("reads the figures a comment states as proposals, and takes one into the report", async () => {
    const { ticket, card, author } = await handled();
    expect((await read(ticket)).comments).toBeNull();
    const said = "Dua orang meninggal, 40 rumah rusak dan 9 orang luka";
    answers.set(said.toLowerCase(), "unused");
    answers.set(said, {
      figures: [
        { figure: "dead", value: 2, quote: "Dua orang meninggal" },
        { figure: "houses", value: 40, quote: "40 rumah rusak" },
        { figure: "injured", value: 9, quote: "9 orang luka" },
        { figure: "missing", value: 5, quote: "5 hilang" },
      ],
    });
    expect((await comment(author, card, said)).status).toBe(201);
    const before = await read(ticket);
    const figures = before.comments?.items[0]?.figures ?? [];
    expect(figures.map((one) => [one.figure, one.value, one.status])).toEqual([
      ["dead", 2, "proposed"],
      ["houses", 40, "proposed"],
      ["injured", 9, "proposed"],
    ]);
    const [dead, houses, injured] = figures.map((one) => one.id) as [number, number, number];

    const taken = await decide(ticket, `comment-figures/${dead}`, { accept: true, reason: "  dicek  ke   kades " });
    expect(taken.status, JSON.stringify(taken.json)).toBe(200);
    const after = deskReportSchema.parse(taken.json);
    expect(after.impact.dead).toBe(2);
    expect(after.history.at(-1)).toMatchObject({
      event: "commentFigure",
      detail: { changes: [{ fieldId: "dead", from: 3, to: 2 }] },
    });
    expect(after.comments?.items[0]?.decisions).toEqual([
      expect.objectContaining({ action: "accept", fieldId: "dead", reason: "dicek ke kades" }),
    ]);
    expect((await decide(ticket, `comment-figures/${dead}`, { accept: true })).status).toBe(409);

    const level = await decide(ticket, `comment-figures/${houses}`, { accept: true });
    expect([level.status, level.error.fields]).toEqual([
      422,
      [expect.objectContaining({ fieldId: "field", copyKey: "fieldError.comments.housesLevel" })],
    ]);
    const heavy = await decide(ticket, `comment-figures/${houses}`, { accept: true, field: "housesHeavy" });
    expect(deskReportSchema.parse(heavy.json).impact.houses).toMatchObject({ count: 40 });
    const turned = await decide(ticket, `comment-figures/${injured}`, { accept: false });
    expect(deskReportSchema.parse(turned.json).comments?.items[0]?.figures[2]).toMatchObject({ status: "rejected" });
    expect((await decide(ticket, `comment-figures/${injured}`, { accept: false })).status).toBe(409);
  });

  test("takes a figure the report holds already without a new version, and refuses one its kind does not use", async () => {
    const { ticket, card, author } = await handled("tanah longsor, tiga orang meninggal");
    answers.set("tiga orang meninggal, 7 rumah terendam", {
      figures: [
        { figure: "dead", value: 3, quote: "tiga orang meninggal" },
        { figure: "flooded", value: 7, quote: "7 rumah terendam" },
      ],
    });
    answers.set("korban 4 orang hilang", "fail");
    answers.set("6 orang luka", "slow");
    expect((await comment(author, card, "tiga orang meninggal, 7 rumah terendam")).status).toBe(201);
    expect((await comment(author, card, "korban 4 orang hilang")).status).toBe(201);
    // A model that does not answer in time leaves the comment with no figures.
    expect((await comment(author, card, "6 orang luka")).status).toBe(201);
    const before = await read(ticket);
    const items = before.comments?.items ?? [];
    expect(items.find((one) => one.text === "korban 4 orang hilang")?.figures).toEqual([]);
    expect(items.find((one) => one.text === "6 orang luka")?.figures).toEqual([]);
    const stated = items.find((one) => one.text.startsWith("tiga"));
    const [dead, flooded] = (stated?.figures ?? []).map((one) => one.id) as [number, number];
    const same = deskReportSchema.parse((await decide(ticket, `comment-figures/${dead}`, { accept: true })).json);
    const taken = same.comments?.items.find((one) => one.id === stated?.id);
    expect([same.versions.length, taken?.figures[0]?.status]).toEqual([before.versions.length, "accepted"]);
    const unused = await decide(ticket, `comment-figures/${flooded}`, { accept: true });
    expect([unused.status, unused.error.fields]).toEqual([
      422,
      [expect.objectContaining({ fieldId: "field", copyKey: "fieldError.comments.fieldNotUsed" })],
    ]);
  });

  test("hides a comment and shows it again, each told once", async () => {
    const { ticket, card, author } = await handled();
    const id = ((await comment(author, card, "hoaks")).json as { comment: { id: string } }).comment.id;
    const hidden = await decide(ticket, `comments/${id}`, { shown: false, reason: "tidak benar" });
    expect(deskReportSchema.parse(hidden.json).comments?.items[0]).toMatchObject({
      status: "hidden",
      authorHidden: 1,
      decisions: [{ action: "hide", reason: "tidak benar" }],
    });
    expect(await shown(card)).toEqual([]);
    expect((await decide(ticket, `comments/${id}`, { shown: false })).status).toBe(409);
    expect((await decide(ticket, `comments/${id}`, { shown: true, reason: "   " })).status).toBe(200);
    expect(await shown(card)).toHaveLength(1);
  });

  test("decides only a comment of the report's own card, in its region, on a report still open", async () => {
    const { ticket, card, author } = await handled();
    const other = await handled();
    answers.set("2 orang luka", { figures: [{ figure: "injured", value: 2, quote: "2 orang luka" }] });
    const id = ((await comment(author, card, "2 orang luka")).json as { comment: { id: string } }).comment.id;
    const figure = (await read(ticket)).comments?.items[0]?.figures[0]?.id as number;
    expect((await decide(other.ticket, `comments/${id}`, { shown: false })).status).toBe(404);
    expect((await decide(other.ticket, `comment-figures/${figure}`, { accept: true })).status).toBe(404);
    expect((await decide(ticket, `comments/${id}`, { shown: false }, PROVINCE)).status).toBe(404);
    expect((await decide(ticket, "comment-figures/99999", { accept: true })).status).toBe(404);
    expect((await decide(ticket, "comments/0123456789abcdef", { shown: false })).status).toBe(404);
    tick();
    const closed = await staff(REGENCY).call("POST", `/desk/reports/${ticket}/status`, {
      to: "closed",
      note: "Penanganan sudah selesai di lokasi dan warga kembali ke rumah masing-masing",
      revision: (await read(ticket)).revision,
    });
    expect(closed.status, JSON.stringify(closed.json)).toBe(200);
    const late = await decide(ticket, `comment-figures/${figure}`, { accept: true }, REGENCY);
    expect([late.status, late.error.error.code]).toEqual([409, "ticket.transitionRefused"]);
  });

  test("refuses a figure for an event whose card is told from another region's report", async () => {
    const north = await handled("banjir, tiga orang meninggal", sumut);
    clock.advance(3_600_000);
    const { ticket } = await handled();
    // The reporter of the later one said it is the same event.
    await query`insert into report_link (ticket_number, same_as, at) values (${ticket}, ${north.ticket}, ${new Date(clock.now())})`;
    clock.advance(61_000);
    const card = feedSchema.parse((await browser(fetchApi).call("GET", "/feed")).json).entries[0]?.id as string;
    answers.set("2 orang hilang", { figures: [{ figure: "missing", value: 2, quote: "2 orang hilang" }] });
    expect((await comment(north.author, card, "2 orang hilang")).status).toBe(201);
    const opened = deskReportSchema.parse((await staff(PROVINCE).call("GET", `/desk/reports/${north.ticket}`)).json);
    const figure = opened.comments?.items[0]?.figures[0]?.id as number;
    const refused = await decide(north.ticket, `comment-figures/${figure}`, { accept: true }, PROVINCE);
    expect([refused.status, refused.error.error.code]).toEqual([403, "desk.notAllowed"]);
  });

  test("lets anyone read a card's comments only within the network's limit", async () => {
    const phone = browser(fetchApi);
    await query`insert into rate_counter (limit_id, subject_key, window_start, count)
      values ('address.feed', ${await limitKey(phone)}, ${new Date(windowStart("clockHour", clock.now()))}, 600)`;
    expect((await phone.call("GET", "/feed/cards/0123456789abcdef/comments")).status).toBe(429);
  });

  test("with the model off, a comment has no figures", async () => {
    const { ticket, card, author } = await handled();
    const off = browser(fetchWith(quiet), author.address);
    for (const [name, value] of author.cookies) off.cookies.set(name, value);
    expect((await comment(off, card, "5 orang luka")).status).toBe(201);
    expect((await read(ticket)).comments?.items[0]?.figures).toEqual([]);
  });
});
