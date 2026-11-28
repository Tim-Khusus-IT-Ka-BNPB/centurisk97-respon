// pnpm copy:translate <language>: drafts src/copy/tr/<language>.json, the report pages' words in one
// of the offered languages, with the model and the key in .env. Lines already in the file are
// kept, so a speaker's corrections stay. Each line must pass translationProblem() or it is left out
// and the page shows the Indonesian. A draft until a speaker of the language has read it (Q44).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isTranslated, translationProblem } from "../../src/copy/translated.ts";

const NAMES: Readonly<Record<string, string>> = {
  en: "English (plain, for visitors and foreign residents in Indonesia)",
  jv: "Javanese (ngoko alus, polite)",
  su: "Sundanese (lemes, polite)",
  mad: "Madurese",
  ban: "Balinese (polite register)",
  sas: "Sasak",
  min: "Minangkabau",
  bbc: "Batak Toba",
  btx: "Batak Karo",
  btm: "Batak Mandailing",
  bts: "Batak Simalungun",
  nia: "Nias",
  ace: "Acehnese",
  msa: "Malay as spoken in Sumatra and Riau",
  ljp: "Lampung",
  bjn: "Banjarese",
  nij: "Ngaju Dayak",
  bug: "Buginese",
  mak: "Makassarese",
  sda: "Toraja-Sa'dan",
  gor: "Gorontalo",
  abs: "Ambonese Malay",
  pmy: "Papuan Malay",
};
const BATCH = 60;

const language = process.argv[2] ?? "";
const name = NAMES[language];
if (name === undefined) {
  process.stderr.write(`Usage: pnpm copy:translate <${Object.keys(NAMES).join("|")}>\n`);
  process.exit(1);
}
const settings = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .flatMap((line) =>
      /^[A-Z_]+=/.test(line) ? [[line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]] : [],
    ),
);
const apiKey = settings.MODEL_API_KEY ?? "";
const model = settings.MODEL_NAME || "claude-sonnet-5-5";
if (apiKey === "") {
  process.stderr.write("No MODEL_API_KEY in .env\n");
  process.exit(1);
}

const source: Record<string, string> = {};
for (const file of readdirSync("src/copy/id"))
  Object.assign(source, JSON.parse(readFileSync(join("src/copy/id", file), "utf8")));
const target = `src/copy/tr/${language}.json`;
const kept: Record<string, string> = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) : {};
const wanted = Object.keys(source).filter((key) => isTranslated(key) && kept[key] === undefined);

const SYSTEM = `You translate the interface of BNPB's disaster report service from Indonesian into ${name}, for residents of Indonesia reporting a disaster.
Rules: translate meaning only, add nothing, keep the register plain and polite. Keep every {placeholder} exactly as written. Keep every number exactly as written, as digits. Keep these unchanged: BNPB, BPBD, Pantau Bencana, WhatsApp, RT, RW, 112, 117, Desa/Kel., Kec. Keep line breaks. Never say that a place or a person is safe. If a word has no good equivalent, keep the Indonesian word.
Answer with a JSON object of the same keys.`;

let added = 0;
const refused: string[] = [];
for (let at = 0; at < wanted.length; at += BATCH) {
  const keys = wanted.slice(at, at + BATCH);
  const lines = Object.fromEntries(keys.map((key) => [key, source[key] as string]));
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": apiKey },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(lines) }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: Object.fromEntries(keys.map((key) => [key, { type: "string" }])),
            required: keys,
            additionalProperties: false,
          },
        },
      },
    }),
  });
  if (!response.ok) {
    process.stderr.write(`Batch ${at / BATCH + 1}: the model answered ${response.status}\n`);
    continue;
  }
  const answer = (await response.json()) as { content?: { type: string; text?: string }[] };
  const text = answer.content?.find((block) => block.type === "text")?.text ?? "{}";
  const translated = JSON.parse(text) as Record<string, string>;
  for (const key of keys) {
    const line = translated[key] ?? "";
    if (translationProblem(source[key] as string, line) === null) {
      kept[key] = line;
      added += 1;
    } else refused.push(key);
  }
  process.stdout.write(`${Math.min(at + BATCH, wanted.length)} of ${wanted.length}\n`);
}
const ordered = Object.fromEntries([
  ["app.lang", language],
  ...Object.keys(source).flatMap((key) => (kept[key] === undefined ? [] : [[key, kept[key]]])),
]);
writeFileSync(target, `${JSON.stringify(ordered, null, 2)}\n`);
process.stdout.write(`${target}: ${added} lines added, ${refused.length} left in Indonesian\n`);
