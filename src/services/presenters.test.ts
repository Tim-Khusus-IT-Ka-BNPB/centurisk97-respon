import { describe, expect, test } from "vitest";
import { seededIdentity } from "../adapters/identity/seeded";
import { httpModel } from "../adapters/model/http";
import { modelOff } from "../adapters/model/off";
import type { Card } from "../contract/card";
import type { FieldState, FieldStates } from "../domain/fieldState";
import { maskText } from "../domain/masking";
import { modelRequest } from "../domain/modelRequest";
import { EMPTY_CONTENT } from "../domain/turn/content";
import { createClock } from "../platform/clock";
import { sqlState } from "../platform/database";
import { createServices, photoStoreOf } from "../platform/services";
import { testBindings, testBucket } from "../testing/api";
import { cardFor } from "./cards";
import { answerLine } from "./extract";
import { summaryGroups } from "./summary";

const tapped = (value: string): FieldState => ({ state: "value", value, origin: "tappedOption" });
const context = {
  cardId: "c-1",
  nowMs: Date.parse("2026-11-23T03:00:00.000Z"),
  zone: "WIB" as const,
  reporter: { name: "Uji Satu", role: "citizen" as const },
  completePercent: 50,
  asked: {},
  photos: [],
};

describe("cards", () => {
  test("a text question shows the words already given", () => {
    const states: FieldStates = {
      displacedPeople: { state: "value", value: 4, origin: "boxEntry" },
      shelters: { state: "value", value: "balai desa", origin: "quote", quote: "ke balai desa" },
    };
    const card = cardFor(
      { kind: "textQuestion", fieldId: "shelters", askedBefore: true },
      { ...EMPTY_CONTENT, states },
      context,
    );
    expect(card).toMatchObject({
      kind: "textQuestion",
      params: { max: 300 },
      fields: [{ id: "shelters", value: "balai desa", origin: "quote", askedBefore: true, maxLength: 300 }],
    });
  });

  test("per-hazard variants are used where the catalogue has one", () => {
    const states: FieldStates = { hazardType: tapped("flood") };
    const card = cardFor({ kind: "choice", fieldId: "farmland" }, { ...EMPTY_CONTENT, states }, context);
    expect(card.titleKey).toBe("field.farmland.label.flood");
    const plain = cardFor({ kind: "choice", fieldId: "roadPassable" }, { ...EMPTY_CONTENT, states }, context);
    expect(plain.titleKey).toBe("field.roadPassable.label");
    expect(cardFor({ kind: "choice", fieldId: "roadPassable" }, EMPTY_CONTENT, context).titleKey).toBe(
      "field.roadPassable.label",
    );
  });

  test("hazard guesses come first, and the other types follow in their order", () => {
    const card = cardFor(
      { kind: "choice", fieldId: "hazardType" },
      { ...EMPTY_CONTENT, guesses: ["earthquake", "flood"] },
      context,
    );
    expect(card.kind === "choice" && card.options.map((option) => option.id).slice(0, 4)).toEqual([
      "earthquake",
      "flood",
      "landslide",
      "tidalWaveAbrasion",
    ]);
  });

  test("a multiple choice marks its exclusive answers and the typed Lainnya", () => {
    const card = cardFor(
      { kind: "multiChoice", fieldId: "urgentNeeds" },
      { ...EMPTY_CONTENT, states: { hazardType: tapped("flood") } },
      context,
    ) as Extract<Card, { kind: "multiChoice" }>;
    expect(card.options.find((option) => option.id === "other")).toMatchObject({
      freeTextMaxLength: 120,
      exclusive: false,
    });
    expect(card.options.find((option) => option.id === "noUrgentNeed")).toMatchObject({ exclusive: true });
    expect(card.options.at(-1)).toMatchObject({ id: "unknown", labelKey: "common.unknown", exclusive: true });
  });
});

describe("summary rows", () => {
  test("RT and RW, several options with typed words, a single option and text show as their values", () => {
    const states: FieldStates = {
      neighbourhood: { state: "value", value: { rt: "3", rw: null }, origin: "boxEntry" },
      hazardType: tapped("flood"),
      vulnerableGroups: { state: "value", value: { optionIds: ["elderly"], otherText: null }, origin: "tappedOption" },
      urgentNeeds: { state: "value", value: { optionIds: ["other"], otherText: "selimut" }, origin: "tappedOption" },
      waterDepth: tapped("knee"),
      displacedPeople: { state: "value", value: 4, origin: "boxEntry" },
      shelters: { state: "value", value: "balai desa", origin: "boxEntry" },
    };
    const rows = summaryGroups(states).flatMap((group) => group.rows);
    expect(Object.fromEntries(rows.map((row) => [row.fieldId, row.value]))).toEqual({
      neighbourhood: { kind: "neighbourhood", rt: "3", rw: null },
      hazardType: { kind: "hazardType", hazardType: "flood" },
      displacedPeople: { kind: "count", count: 4 },
      shelters: { kind: "text", text: "balai desa" },
      vulnerableGroups: { kind: "options", optionIds: ["elderly"], otherText: null },
      waterDepth: { kind: "options", optionIds: ["knee"], otherText: null },
      urgentNeeds: { kind: "options", optionIds: ["other"], otherText: "selimut" },
    });
  });
});

describe("the reporter's line for a card answer", () => {
  const card = cardFor(
    { kind: "numberForm", groupId: "victims", fieldIds: ["dead", "missing"], askedBefore: false },
    EMPTY_CONTENT,
    context,
  );
  test("labels of the picks and boxes typed, masked; empty boxes and unknown keys left out", () => {
    expect(
      answerLine(card, ["allNone"], { dead: "2", missing: " ", extra: "Uji Satu" }, { name: "Uji Satu", number: null }),
    ).toBe("Tidak ada semua, Meninggal: 2, [nama pelapor]");
    expect(answerLine(card, ["nonsense"], {}, { name: null, number: null })).toBe("");
  });

  test("the browser's time and date boxes are said as the app writes them", () => {
    const time = cardFor({ kind: "eventTime" }, EMPTY_CONTENT, context);
    const nobody = { name: null, number: null };
    expect(answerLine(time, ["yesterday"], { hour: "21:31" }, nobody)).toBe("Kemarin, Jam: 21.31");
    expect(answerLine(time, ["otherDate"], { date: "2026-11-20" }, nobody)).toBe(
      "Tanggal lain, Tanggal: 20 November 2026",
    );
  });
});

describe("ports chosen by the settings", () => {
  const { bindings } = testBindings();
  test("files in a bucket in memory with no S3, else in the S3 named, signed with its key", async () => {
    const memory = photoStoreOf(bindings.settings);
    await memory.put("k", new Uint8Array([1]));
    expect(await memory.get("k")).toEqual(new Uint8Array([1]));
    const s3 = {
      endpoint: "http://127.0.0.1:9",
      region: "garage",
      bucket: "respon-files",
      accessKeyId: "GK1",
      secretAccessKey: "s",
    };
    await expect(photoStoreOf({ ...bindings.settings, s3 }).get("k")).rejects.toThrow();
  });

  test("off, recorded and live models; the seeded identity; the upstream identity is not built", async () => {
    expect(createServices(bindings.settings, bindings.log, bindings.db, testBucket(), bindings.clock).model).toBe(
      modelOff,
    );
    expect(
      await modelOff.extract(
        modelRequest(maskText("x", { name: null, number: null }), {}),
        new AbortController().signal,
      ),
    ).toBeNull();
    const recorded = createServices(
      { ...bindings.settings, model: { mode: "recorded", baseUrl: "http://localhost:8790", name: "recorded" } },
      bindings.log,
      bindings.db,
      testBucket(),
      bindings.clock,
    );
    expect(recorded.model).not.toBe(modelOff);
    const live = createServices(
      { ...bindings.settings, model: { mode: "live", baseUrl: "https://api.anthropic.com", apiKey: "k", name: "m" } },
      bindings.log,
      bindings.db,
      testBucket(),
      bindings.clock,
    );
    expect(live.model).not.toBe(modelOff);
    expect(Object.keys(seededIdentity(bindings.db, bindings.clock)).sort()).toEqual(["officers", "resolve"]);
    const auth = {
      ...bindings.settings,
      identityAdapter: "auth" as const,
      auth: { issuer: "https://auth.example.test", clientId: "respon", clientSecret: "x".repeat(32) },
    };
    const withAuth = createServices(auth, bindings.log, bindings.db, testBucket(), bindings.clock);
    expect(Object.keys(withAuth.identity).sort()).toEqual(["officers", "resolve"]);
    expect(Object.keys(withAuth.signIn ?? {}).sort()).toEqual(["endUrl", "finish", "start"]);
    expect(
      createServices(bindings.settings, bindings.log, bindings.db, testBucket(), bindings.clock).signIn,
    ).toBeNull();
  });
});

describe("the model over HTTP", () => {
  const request = modelRequest(maskText("air naik", { name: null, number: null }), {});
  const signal = new AbortController().signal;
  test("sends the masked request with the key when there is one, and reads the structured answer", async () => {
    const seen: RequestInit[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      seen.push(init);
      return Response.json({ content: [{ type: "thinking" }, { type: "text", text: '{"topic":"disaster"}' }] });
    }) as typeof fetch;
    expect(
      await httpModel({ baseUrl: "https://api.anthropic.com", name: "m", apiKey: "k" }, fetchFn).extract(
        request,
        signal,
      ),
    ).toEqual({ topic: "disaster" });
    expect(new Headers(seen[0]?.headers).get("x-api-key")).toBe("k");
    await httpModel({ baseUrl: "http://localhost:8790", name: "m", apiKey: null }, fetchFn).extract(request, signal);
    expect(new Headers(seen[1]?.headers).has("x-api-key")).toBe(false);
    expect(JSON.parse(seen[1]?.body as string)).toMatchObject({
      model: "m",
      messages: [{ role: "user", content: request.user }],
      thinking: { type: "between_tools" },
      output_config: { format: { type: "json_schema" } },
    });
  });

  test("a failure, an answer with no text, a text that is not JSON, or an abort is no answer", async () => {
    const answering = (response: () => Response) =>
      httpModel({ baseUrl: "x", name: "m", apiKey: null }, (async () => response()) as unknown as typeof fetch);
    expect(await answering(() => new Response("", { status: 500 })).extract(request, signal)).toBeNull();
    expect(await answering(() => Response.json({ content: [] })).extract(request, signal)).toBeNull();
    expect(await answering(() => Response.json({})).extract(request, signal)).toBeNull();
    expect(
      await answering(() => Response.json({ content: [{ type: "text", text: "Laporan lengkap" }] })).extract(
        request,
        signal,
      ),
    ).toBeNull();
    const aborted = httpModel({ baseUrl: "x", name: "m", apiKey: null }, (async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch);
    expect(await aborted.extract(request, signal)).toBeNull();
  });
});

describe("platform helpers", () => {
  test("a driver error is reduced to its SQL state, anything else to nothing", () => {
    const unique = Object.assign(new Error("duplicate key value (number)=(+62...)"), { code: "23505" });
    expect(sqlState(unique)).toBe("23505");
    expect(sqlState(new Error("Failed query", { cause: unique }))).toBe("23505");
    expect(sqlState(new Error("Failed query", { cause: new Error("plain") }))).toBeNull();
    expect(sqlState(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }))).toBeNull();
    expect(sqlState(new Error("connect ECONNREFUSED"))).toBeNull();
    expect(sqlState({ code: 5 })).toBeNull();
    expect(sqlState(null)).toBeNull();
  });

  test("the fixed clock starts at its setting and runs with real time; with none it is real time", () => {
    let real = 1_000;
    const fixed = createClock(Date.parse("2026-11-23T03:00:00.000Z"), () => real);
    real += 4_000;
    expect(fixed.now()).toBe(Date.parse("2026-11-23T03:00:04.000Z"));
    expect(createClock(null, () => 42).now()).toBe(42);
    expect(Math.abs(createClock(null).now() - Date.now())).toBeLessThan(1000);
  });
});
