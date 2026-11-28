// pnpm model:eval [case id...] [--raw]: sends each case in cases.ts to the model with the key in
// .env, through respon's own request and validation, and scores what the chat would keep. A guide
// for prompt changes, never part of the tests: it costs a call per case and the answers vary.
import { readFileSync } from "node:fs";
import { httpModel } from "../../src/adapters/model/http.ts";
import { validateExtraction } from "../../src/domain/extraction.ts";
import type { FieldStates } from "../../src/domain/fieldState.ts";
import { maskText } from "../../src/domain/masking.ts";
import { modelRequest } from "../../src/domain/modelRequest.ts";
import { CASES, type EvalCase } from "./cases.ts";

const settings = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .flatMap((line) =>
      /^[A-Z_]+=/.test(line) ? [[line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]] : [],
    ),
);
if (!settings.MODEL_API_KEY) {
  process.stderr.write("No MODEL_API_KEY in .env\n");
  process.exit(1);
}
const model = httpModel({
  baseUrl: settings.MODEL_BASE_URL || "https://api.anthropic.com",
  name: settings.MODEL_NAME || "claude-sonnet-5-5",
  apiKey: settings.MODEL_API_KEY,
});

const args = process.argv.slice(2);
const raw = args.includes("--raw");
const only = args.filter((arg) => !arg.startsWith("--"));
const cases = only.length === 0 ? CASES : CASES.filter((one) => only.includes(one.id));

type Check = { readonly kind: string; readonly ok: boolean; readonly detail: string };

// What the validated extraction holds for a field, in the shape the case states it.
function heldValue(held: unknown): number | string | readonly string[] | undefined {
  const one = held as { kind?: string; count?: number; text?: string; optionIds?: readonly string[] } | undefined;
  if (one?.kind === "count") return one.count;
  if (one?.kind === "text") return one.text;
  if (one?.optionIds) return one.optionIds;
  return undefined;
}

function fieldCheck(field: string, want: number | string | readonly string[], held: unknown): Check {
  const got = heldValue(held);
  const shown = JSON.stringify(got);
  if (typeof want === "number") return { kind: "count", ok: got === want, detail: `${field}=${want} got ${shown}` };
  if (Array.isArray(want)) {
    const ok = Array.isArray(got) && want.every((id) => got.includes(id));
    return { kind: "multi", ok, detail: `${field}⊇${JSON.stringify(want)} got ${shown}` };
  }
  if (Array.isArray(got)) return { kind: "choice", ok: got[0] === want, detail: `${field}=${want} got ${shown}` };
  const ok = typeof got === "string" && got.toLowerCase().includes(String(want).toLowerCase());
  return { kind: "text", ok, detail: `${field}~${want} got ${shown}` };
}

async function run(one: EvalCase) {
  const states: FieldStates =
    one.hazardType === null ? {} : { hazardType: { state: "value", value: one.hazardType, origin: "tappedOption" } };
  const message = maskText(one.message, { name: null, number: null });
  const started = performance.now();
  const output = await model.extract(modelRequest(message, states), AbortSignal.timeout(20_000));
  const ms = Math.round(performance.now() - started);
  const extraction = validateExtraction(output, message, one.hazardType) as ReturnType<typeof validateExtraction> & {
    readonly indonesian?: string | null;
  };
  const checks: Check[] = [];
  const { expect } = one;
  const top = extraction.hazardGuesses[0];
  if (expect.hazard)
    checks.push({ kind: "hazard", ok: top?.hazardType === expect.hazard, detail: `hazard ${top?.hazardType}` });
  if (expect.subtype)
    checks.push({ kind: "subtype", ok: top?.subtype === expect.subtype, detail: `subtype ${top?.subtype}` });
  for (const [field, want] of Object.entries(expect.fields ?? {}))
    checks.push(fieldCheck(field, want, (extraction.fields as Record<string, unknown>)[field]));
  for (const field of expect.absent ?? [])
    checks.push({
      kind: "absent",
      ok: !(field in extraction.fields),
      detail: `${field} must stay empty, got ${JSON.stringify(heldValue((extraction.fields as Record<string, unknown>)[field]))}`,
    });
  if (expect.lifeAtRisk !== undefined)
    checks.push({
      kind: "life",
      ok: extraction.lifeAtRisk === expect.lifeAtRisk,
      detail: `life ${extraction.lifeAtRisk}`,
    });
  if (expect.topic)
    checks.push({ kind: "topic", ok: extraction.topic === expect.topic, detail: `topic ${extraction.topic}` });
  for (const word of expect.indonesian ?? [])
    checks.push({
      kind: "translation",
      ok: (extraction.indonesian ?? "").toLowerCase().includes(word),
      detail: `translation has "${word}": ${JSON.stringify(extraction.indonesian ?? null)}`,
    });
  return { one, ms, checks, output, answered: output !== null };
}

const results = [];
for (let at = 0; at < cases.length; at += 4)
  results.push(...(await Promise.all(cases.slice(at, at + 4).map((one) => run(one)))));

const totals = new Map<string, { ok: number; all: number }>();
for (const { one, ms, checks, output, answered } of results) {
  const failed = checks.filter((check) => !check.ok);
  for (const check of checks) {
    const total = totals.get(check.kind) ?? { ok: 0, all: 0 };
    totals.set(check.kind, { ok: total.ok + (check.ok ? 1 : 0), all: total.all + 1 });
  }
  const mark = !answered ? "NO ANSWER" : failed.length === 0 ? "ok" : `${failed.length} wrong`;
  process.stdout.write(`${one.id.padEnd(22)} ${one.language.padEnd(4)} ${String(ms).padStart(5)}ms  ${mark}\n`);
  for (const check of failed) process.stdout.write(`    - ${check.kind}: ${check.detail}\n`);
  if (raw && failed.length > 0) process.stdout.write(`    raw: ${JSON.stringify(output)}\n`);
}
let ok = 0;
let all = 0;
for (const [kind, total] of totals) {
  ok += total.ok;
  all += total.all;
  process.stdout.write(`${kind.padEnd(12)} ${total.ok}/${total.all}\n`);
}
process.stdout.write(`score        ${ok}/${all} (${Math.round((ok / all) * 100)}%)\n`);
