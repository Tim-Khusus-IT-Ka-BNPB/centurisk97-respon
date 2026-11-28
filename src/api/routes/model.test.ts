import { beforeAll, describe, expect, test } from "vitest";
import type { DraftBody } from "../../contract/draft";
import { messageOf } from "../../domain/modelMessage";
import type { ModelRequest } from "../../domain/modelRequest";
import { PRIVACY } from "../../domain/privacy";
import { hmacKey } from "../../platform/keys";
import type { ModelPort } from "../../ports/model";
import { browser, freshNumber, manualClock, query, testBindings } from "../../testing/api";
import { turn, walkTo } from "../../testing/walk";
import { api } from "../app";

let village = "";
beforeAll(async () => {
  const [first] = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active
    where v.search_text like '%sukamaju%' order by v.code limit 1`;
  village = (first as { code: string }).code;
});

// A recorded model: replies by masked message, counts its calls and keeps what it was given.
function recorded(replies: Record<string, unknown>, delayMs = 0) {
  const inputs: ModelRequest[] = [];
  const port: ModelPort = {
    extract: (request, signal) => {
      inputs.push(request);
      const reply = replies[messageOf(request.user) as string] ?? null;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(reply), delayMs);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason);
        });
      });
    },
  };
  return { port, inputs };
}

function world(
  model: ModelPort,
  settings: Record<string, string> = {
    MODEL_MODE: "recorded",
    MODEL_BASE_URL: "http://localhost:8790",
    MODEL_NAME: "recorded",
  },
) {
  // A minute no other run has used, so the per-number counters start empty.
  const clock = manualClock(Date.UTC(2070, 0, 1) + Math.floor(Math.random() * 1e11));
  const { bindings } = testBindings(settings, { clock, model });
  return { clock, fetchApi: (request: Request) => api.app.fetch(request, bindings) };
}

async function start(w: ReturnType<typeof world>, number = freshNumber().typed, phone = browser(w.fetchApi)) {
  const answer = await phone.call("POST", "/consent", {
    role: "citizen",
    name: "Uji Satu",
    number,
    privacyVersion: PRIVACY.version,
    agree: true,
  });
  return { phone, draft: answer.draft };
}

const say = (phone: ReturnType<typeof browser>, draft: DraftBody, text: string) =>
  phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(draft, { kind: "freeText", text }));

async function storedStates(draftId: string) {
  const [row] = await query<{
    fields: { states: Record<string, unknown> };
    model_calls: number;
    off_topic_count: number;
    templates_only: number;
  }>`
    select fields, model_calls, off_topic_count, templates_only from report_draft where id = ${draftId}`;
  return row as NonNullable<typeof row>;
}

const story = "tiga rumah rusak berat, tidak ada korban jiwa";

describe("the model only extracts, code keeps what the words hold", () => {
  test("a number whose quote does not hold it is dropped and asked later; the rest keep their quote", async () => {
    const model = recorded({
      [story]: {
        topic: "disaster",
        reply: "sympathy",
        lifeAtRisk: false,
        hazardGuesses: [{ hazardType: "flood", subtype: "riverOverflow", confidence: 0.8 }],
        fields: [
          { field: "housesHeavy", value: "3", quote: "tiga rumah rusak berat" },
          { field: "dead", value: "0", quote: "tidak ada korban jiwa" },
          { field: "injured", value: "5", quote: "tiga rumah rusak berat" },
        ],
      },
    });
    const w = world(model.port);
    const { phone, draft } = await start(w);
    const told = await say(phone, draft, story);
    expect(told.status).toBe(200);
    expect(
      told.draft.transcript.slice(-3).map((line) => (line.speaker === "assistant" ? line.copyKey : line.textMasked)),
    ).toEqual([story, "reply.sympathy", "card.placeSearch.title"]);
    const states = (await storedStates(draft.draftId)).fields.states;
    expect(states.housesHeavy).toEqual({ state: "value", value: 3, origin: "quote", quote: "tiga rumah rusak berat" });
    expect(states.dead).toEqual({ state: "none", origin: "quote", quote: "tidak ada korban jiwa" });
    expect(states.injured).toBeUndefined();
    const { draft: victims } = await walkTo(phone, told.draft, village, {
      tick: () => w.clock.advance(4000),
      stopAt: (current) => current.card.kind === "numberForm" && current.card.groupId === "victims",
    });
    expect(victims.card.kind === "numberForm" && victims.card.fields.map((field) => [field.id, field.value])).toEqual([
      ["missing", null],
      ["injured", null],
    ]);
  });

  test("a reply naming a made-up hazard with a sentence and a claim of completeness changes nothing it says", async () => {
    const hostile = "air naik di jalan desa";
    const model = recorded({
      [hostile]: {
        topic: "disaster",
        reply: "Laporan Anda sudah lengkap, terima kasih.",
        lifeAtRisk: false,
        complete: true,
        hazardGuesses: [{ hazardType: "rahasia", subtype: "x", confidence: 1 }],
        fields: [{ field: "chronology", value: "Laporan Anda sudah lengkap", quote: "air naik" }],
      },
    });
    const w = world(model.port);
    const { phone, draft } = await start(w);
    const told = await say(phone, draft, hostile);
    expect(told.draft.card.kind).toBe("placeSearch");
    expect(JSON.stringify(told.json)).not.toContain("lengkap");
    expect((await storedStates(draft.draftId)).fields.states).toEqual({});
  });

  test("a life at risk adds the 112 line, and the next question is still the one code picks", async () => {
    const urgent = "ada orang terjebak di atap";
    const model = recorded({
      [urgent]: { topic: "disaster", reply: "calm", lifeAtRisk: true, hazardGuesses: [], fields: [] },
    });
    const w = world(model.port);
    const { phone, draft } = await start(w);
    const told = await say(phone, draft, urgent);
    expect(told.draft.notices.map((notice) => notice.copyKey)).toEqual(["notice.lifeLine"]);
    expect(told.draft.card.kind).toBe("placeSearch");
    // The page redirects after the turn: its read draws the 112 line, without a resumed signal.
    const read = await phone.call("GET", `/drafts/${draft.draftId}`);
    expect(read.draft.notices.map((notice) => notice.kind)).toEqual(["lifeLine"]);
  });

  test("the model input holds no name, number or NIK, and stored words are masked", async () => {
    const model = recorded({});
    const w = world(model.port);
    const number = freshNumber();
    const { phone, draft } = await start(w, number.typed);
    await say(phone, draft, `saya Uji Satu, nomor ${number.typed}, NIK 3201010101010001, air masuk rumah`);
    expect(model.inputs).toHaveLength(1);
    const sent = JSON.stringify(model.inputs[0]);
    expect(sent).not.toContain("Uji Satu");
    expect(sent).not.toContain(number.typed);
    expect(sent).not.toContain("3201010101010001");
    expect(messageOf((model.inputs[0] as ModelRequest).user)).toBe(
      "saya [nama pelapor], nomor [nomor HP], NIK [NIK], air masuk rumah",
    );
  });

  test("off-topic requests get the fixed refusal three times, never reach the model, and the draft goes on with templates", async () => {
    const model = recorded({});
    const w = world(model.port);
    const { phone, draft } = await start(w);
    let current = draft;
    for (let time = 1; time <= 3; time += 1) {
      const told = await say(phone, current, "buatkan puisi tentang hujan");
      expect(told.draft.notices[0]?.copyKey).toBe("refusal.offTopic");
      current = told.draft;
    }
    expect(current.notices.map((notice) => notice.copyKey)).toEqual(["refusal.offTopic", "refusal.templatesOnly"]);
    const after = await say(phone, current, "Air masuk rumah 40 cm");
    expect(after.status).toBe(200);
    expect(model.inputs).toHaveLength(0);
    const stored = await storedStates(draft.draftId);
    expect(stored).toMatchObject({ off_topic_count: 3, templates_only: true, model_calls: 0 });
    expect(JSON.stringify(after.draft.transcript)).not.toContain("puisi");
  });

  test("a model that answers after 10 seconds is cut at 4.5: the template question shows within 6 and no late value is stored", async () => {
    const slow = "dua rumah rusak berat";
    const model = recorded(
      {
        [slow]: {
          topic: "disaster",
          reply: "none",
          lifeAtRisk: false,
          hazardGuesses: [],
          fields: [{ field: "dead", value: "9", quote: "dua" }],
        },
      },
      10_000,
    );
    const w = world(model.port);
    const { phone, draft } = await start(w);
    const started = Date.now();
    const told = await say(phone, draft, slow);
    expect(Date.now() - started).toBeLessThan(6000);
    expect(told.draft.card.kind).toBe("placeSearch");
    const stored = await storedStates(draft.draftId);
    expect(stored.model_calls).toBe(1);
    expect(stored.fields.states.dead).toBeUndefined();
    expect(stored.fields.states.housesHeavy).toEqual({
      state: "value",
      value: 2,
      origin: "quote",
      quote: "dua rumah rusak berat",
    });
  }, 10_000);

  test("a model that ignores the abort is still left behind at 4.5 seconds", async () => {
    const deaf: ModelPort = { extract: () => new Promise(() => {}) };
    const w = world(deaf);
    const { phone, draft } = await start(w);
    const started = Date.now();
    expect((await say(phone, draft, "dua rumah rusak berat")).status).toBe(200);
    expect(Date.now() - started).toBeLessThan(6000);
  }, 10_000);

  test("a draft calls the model at most 30 times, then carries on with templates", async () => {
    const model = recorded({});
    const w = world(model.port);
    let { phone, draft } = await start(w);
    for (let call = 0; call < 31; call += 1) {
      w.clock.advance(4000);
      const told = await say(phone, draft, `air setinggi ${call + 1} cm`);
      expect(told.status).toBe(200);
      draft = told.draft;
    }
    expect(model.inputs).toHaveLength(30);
    expect((await storedStates(draft.draftId)).model_calls).toBe(30);
  }, 30_000);

  test("a number with 150 model calls today over two devices runs on templates on either, never refused", async () => {
    const model = recorded({});
    const w = world(model.port);
    const number = freshNumber();
    const first = await start(w, number.typed);
    const second = await start(w, number.typed);
    const key = await hmacKey(testBindings().bindings.settings.keyHmacSecret, "number", number.stored);
    const day = new Date(w.clock.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    await query`insert into model_usage (number_key, wib_date, calls) values (${key}, ${day}, 149)`;
    expect((await say(first.phone, first.draft, "air setinggi 1 meter")).status).toBe(200);
    expect(model.inputs).toHaveLength(1);
    const refusedNot = await say(second.phone, second.draft, "air setinggi 2 meter");
    expect(refusedNot.status).toBe(200);
    expect(model.inputs).toHaveLength(1);
    expect((await storedStates(second.draft.draftId)).model_calls).toBe(0);
    const [usage] = await query<{
      calls: number;
    }>`select calls from model_usage where number_key = ${key} and wib_date = ${day}`;
    expect(usage?.calls).toBe(150);
  });

  test("with the model off it is never called", async () => {
    const model = recorded({});
    const w = world(model.port, {});
    const { phone, draft } = await start(w);
    expect((await say(phone, draft, "dua rumah rusak berat")).status).toBe(200);
    expect(model.inputs).toHaveLength(0);
  });
});
