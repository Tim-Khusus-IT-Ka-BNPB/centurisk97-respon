import { beforeAll, describe, expect, test } from "vitest";
import { SYNTHETIC_REPORTERS } from "../../../db/synthetic/reporters";
import { httpModel } from "../../adapters/model/http";
import type { Card } from "../../contract/card";
import type { DraftBody } from "../../contract/draft";
import { copy } from "../../copy";
import { type FieldId, fieldById } from "../../domain/fields/catalogue";
import { messageOf } from "../../domain/modelMessage";
import { sha256Hex } from "../../platform/keys";
import { browser, manualClock, query, testBindings } from "../../testing/api";
import { defaultAnswer, turn, walkTo } from "../../testing/walk";
import { api } from "../app";

type Step = {
  at: string;
  say?: string;
  masked?: string | null;
  model?: unknown;
  expectModelCall?: boolean;
  tap?: string;
  values?: Record<string, string>;
};
type Expected = { state: string; value?: unknown; origin?: string; quote?: string };
type Conversation = {
  id: string;
  reporter: string;
  role: "citizen" | "claimedOfficer";
  officer?: { regency: string; position: string };
  taps: Record<string, string>;
  steps: Step[];
  final: Record<string, Expected>;
  absent?: string[];
  neverInModelInput?: string[];
  neverShown?: string[];
  refusals?: number;
  notices?: { after: number; kind: string }[];
  summaryShows?: string[];
  hazardChoicesShown?: number;
};

// The recorded conversations, the same files the local model stub answers from.
const files = import.meta.glob("../../../tools/model-stub/fixtures/*.json", { eager: true, import: "default" });
const conversations = Object.values(files) as Conversation[];

let village = "";
beforeAll(async () => {
  const [first] = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active
    where v.search_text like '%sukamaju%' order by v.code limit 1`;
  village = (first as { code: string }).code;
});

// The provider as the stub plays it: a reply only for a known masked message, else 500.
async function recordedProvider(all: readonly Conversation[]) {
  const replies = new Map<string, unknown>();
  for (const conversation of all)
    for (const step of conversation.steps)
      if (typeof step.masked === "string" && step.model) replies.set(await sha256Hex(step.masked), step.model);
  const received: string[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const masked = messageOf(
      (JSON.parse(init.body as string) as { messages: { content: string }[] }).messages[0]?.content as string,
    ) as string;
    received.push(masked);
    const reply = replies.get(await sha256Hex(masked));
    return reply === undefined
      ? new Response("{}", { status: 500 })
      : Response.json({ content: [{ type: "text", text: JSON.stringify(reply) }] });
  }) as typeof fetch;
  return { fetchFn, received };
}

const labelOf = (option: { labelKey: string }) => (copy.has(option.labelKey) ? copy.text(option.labelKey) : "");
const fieldOf = (card: Card) => ("fieldId" in card ? card.fieldId : "groupId" in card ? card.groupId : "");
const at = (draft: DraftBody) =>
  draft.card.kind === "choice" || draft.card.kind === "summary"
    ? draft.card.kind === "summary"
      ? "summary"
      : fieldOf(draft.card)
    : `${draft.card.kind}:${fieldOf(draft.card)}`;

function pick(conversation: Conversation, card: Card): Record<string, unknown> | null {
  const label = conversation.taps[card.kind === "timeCard" ? "eventTime" : fieldOf(card)];
  if (label && "options" in card) {
    const option = card.options.find((candidate) => labelOf(candidate) === label);
    expect(option, `${conversation.id} ${label}`).toBeDefined();
    return { optionIds: card.kind === "timeCard" ? [option?.id] : [option?.id] };
  }
  if (card.kind === "choice") return { optionIds: ["unknown"] };
  if (card.kind === "numberForm") return { optionIds: ["allUnknown"] };
  return defaultAnswer(card, village);
}

function rendered(card: Card): string[] {
  if (card.kind !== "summary") return [];
  const lines = [
    copy.format("card.summary.reporter", {
      name: card.reporter.name,
      role: copy.text(card.reporter.role === "citizen" ? "identity.role.citizen" : "identity.role.officer"),
    }),
  ];
  for (const row of card.groups.flatMap((group) => group.rows)) {
    const field = fieldById(row.fieldId as FieldId);
    const label = copy.text(`field.${row.fieldId}.label`);
    if (row.state === "none") lines.push(`${label}: ${copy.text("state.none")}`);
    if (row.state === "notYetKnown") lines.push(`${label}: ${copy.text("state.notYetKnown")}`);
    if (row.value?.kind === "eventTime" && row.value.time.kind === "olderThan30Days")
      lines.push(copy.text("value.eventTime.olderThan30Days"));
    if (row.value?.kind === "count" && field.kind === "count")
      lines.push(`${label}: ${row.value.count} ${copy.text(`unit.${field.unit}`)}`);
  }
  return lines;
}

describe("the recorded conversations replayed through the stub", () => {
  test("there are at least 12, one per hazard type and more", () => {
    expect(conversations.length).toBeGreaterThanOrEqual(12);
  });

  for (const conversation of conversations) {
    test(`conversation ${conversation.id}: every value has an origin, no empty value is 0, and nothing the model invented is kept`, async () => {
      const provider = await recordedProvider(conversations);
      const day = Date.UTC(2050 + Math.floor(Math.random() * 40), Math.floor(Math.random() * 12), 1, 3);
      const clock = manualClock(day);
      const settings = { MODEL_MODE: "recorded", MODEL_BASE_URL: "http://localhost:8790", MODEL_NAME: "recorded" };
      const { bindings } = testBindings(settings, {
        clock,
        model: httpModel({ baseUrl: "http://localhost:8790", name: "recorded", apiKey: null }, provider.fetchFn),
      });
      const phone = browser((request) => api.app.fetch(request, bindings));
      const reporter = SYNTHETIC_REPORTERS.find(
        (candidate) => candidate.label === conversation.reporter,
      ) as (typeof SYNTHETIC_REPORTERS)[number];
      const consent = await phone.call("POST", "/consent", {
        role: conversation.role,
        name: reporter.name,
        number: reporter.typed,
        officerRegency: conversation.officer?.regency ?? "",
        officerPosition: conversation.officer?.position ?? "",
        privacyVersion: 2,
        agree: true,
      });
      expect(consent.status).toBe(201);
      let draft = consent.draft;
      const bodies: unknown[] = [];
      let refusals = 0;
      const tick = () => clock.advance(4000);
      for (const [index, step] of conversation.steps.entries()) {
        draft = (
          await walkTo(phone, draft, village, {
            tick,
            stopAt: (current) => at(current) === step.at,
            overrides: {
              choice: (card) => pick(conversation, card),
              multiChoice: (card) => pick(conversation, card),
              numberForm: (card) => pick(conversation, card),
              timeCard: (card) => pick(conversation, card),
            },
          })
        ).draft;
        if (conversation.hazardChoicesShown && draft.card.kind === "choice" && draft.card.fieldId === "hazardType")
          expect(draft.card.options).toHaveLength(conversation.hazardChoicesShown);
        tick();
        const body = step.say !== undefined ? { kind: "freeText", text: step.say } : { values: step.values ?? {} };
        const answer = await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(draft, body));
        expect(answer.status, `${conversation.id} step ${index + 1}`).toBe(200);
        draft = answer.draft;
        bodies.push(answer.json);
        refusals += draft.notices.filter((notice) => notice.kind === "refusal").length;
        for (const notice of conversation.notices?.filter((expected) => expected.after === index + 1) ?? [])
          expect(draft.notices.map((shown) => shown.kind)).toContain(notice.kind);
      }
      const expectedCalls = conversation.steps.filter((step) => step.expectModelCall).map((step) => step.masked);
      expect(provider.received).toEqual(expectedCalls);
      const summary = (
        await walkTo(phone, draft, village, {
          tick,
          overrides: {
            choice: (card) => pick(conversation, card),
            multiChoice: (card) => pick(conversation, card),
            numberForm: (card) => pick(conversation, card),
            timeCard: (card) => pick(conversation, card),
          },
        })
      ).draft;
      bodies.push(summary);
      const [stored] = await query<{
        fields: { states: Record<string, Expected> };
        state: string;
      }>`select fields, state from report_draft where id = ${draft.draftId}`;
      const states = stored?.fields.states ?? {};
      const said = (bodies as { transcript?: { speaker: string; textMasked?: string }[] }[])
        .flatMap((body) => body.transcript ?? [])
        .filter((line) => line.speaker === "reporter")
        .map((line) => line.textMasked)
        .join(" ");
      expect(stored?.state).toBe("summary");
      for (const [fieldId, expected] of Object.entries(conversation.final)) {
        const { value, ...rest } = expected;
        const want = expected.state === "value" ? expected : rest;
        expect(states[fieldId], `${conversation.id} ${fieldId}`).toEqual(want);
      }
      for (const [fieldId, state] of Object.entries(states)) {
        const field = fieldById(fieldId as FieldId);
        if (field.group !== "event" && !(fieldId in conversation.final))
          expect(state, `${conversation.id} ${fieldId}`).toEqual({ state: "confirmedUnknown", origin: "tappedOption" });
        if (state.state !== "none") expect(state.value, `${conversation.id} ${fieldId}`).not.toBe(0);
        if (state.state === "value" && typeof state.value === "number") {
          expect(["quote", "boxEntry", "tappedOption"], `${conversation.id} ${fieldId}`).toContain(state.origin);
          // A count taken from words keeps the words it came from, as the reporter wrote them, masked.
          if (state.origin === "quote") expect(said, `${conversation.id} ${fieldId}`).toContain(state.quote);
        }
      }
      for (const fieldId of conversation.absent ?? [])
        expect(states[fieldId], `${conversation.id} ${fieldId}`).toBeUndefined();
      for (const word of conversation.neverInModelInput ?? []) expect(provider.received.join(" ")).not.toContain(word);
      // The joined chronology and the reporter's own lines come from catalogue labels and their words,
      // which may share a word with a model sentence; only what the model could have put there is checked.
      const shown = JSON.stringify(bodies, (key, value) =>
        key === "text" || key === "textMasked" ? undefined : value,
      );
      for (const word of conversation.neverShown ?? []) expect(shown).not.toContain(word);
      expect(refusals).toBe(conversation.refusals ?? 0);
      for (const line of conversation.summaryShows ?? []) expect(rendered(summary.card).join("\n")).toContain(line);
    }, 20_000);
  }
});
