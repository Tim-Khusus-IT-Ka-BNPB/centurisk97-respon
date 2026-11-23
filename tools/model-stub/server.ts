import { createHash } from "node:crypto";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { messageOf } from "../../src/domain/modelMessage.ts";

// Local stand-in for the model provider's Messages API, behind the real HTTP adapter. Replies
// are recorded fixtures keyed by the SHA-256 of the masked message. A message with no fixture
// answers 500, so no test can pass on a made-up reply. Every call is logged by hash and masked text.
type Step = { masked?: string | null; model?: unknown; delayMs?: number };
type Fixture = { readonly reply: unknown; readonly delayMs: number };
type Call = { readonly at: string; readonly hash: string; readonly masked: string | null; readonly answered: boolean };

const FIXTURES = join(import.meta.dirname, "fixtures");
const port = Number(process.env.MODEL_STUB_PORT ?? "8790");
const defaultDelay = Number(process.env.MODEL_STUB_DELAY_MS ?? "0");
const logFile = process.env.MODEL_STUB_LOG ?? "";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function loadFixtures(): Map<string, Fixture> {
  const fixtures = new Map<string, Fixture>();
  for (const file of readdirSync(FIXTURES).filter((name) => name.endsWith(".json"))) {
    const conversation = JSON.parse(readFileSync(join(FIXTURES, file), "utf8")) as { steps: Step[] };
    for (const step of conversation.steps) {
      if (typeof step.masked === "string" && step.model)
        fixtures.set(sha256(step.masked), { reply: step.model, delayMs: step.delayMs ?? defaultDelay });
    }
  }
  return fixtures;
}

const fixtures = loadFixtures();
const calls: Call[] = [];

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function messages(request: IncomingMessage, response: ServerResponse) {
  const body = JSON.parse(await bodyOf(request)) as { messages?: { content?: string }[] };
  const masked = messageOf(body.messages?.[0]?.content ?? "");
  const hash = sha256(masked ?? "");
  const fixture = fixtures.get(hash);
  const call = { at: new Date().toISOString(), hash, masked, answered: fixture !== undefined };
  calls.push(call);
  if (logFile) appendFileSync(logFile, `${JSON.stringify(call)}\n`);
  if (!fixture) return send(response, 500, { type: "error", error: { type: "no_fixture" } });
  await new Promise((resolve) => setTimeout(resolve, fixture.delayMs));
  if (!response.destroyed) send(response, 200, { content: [{ type: "text", text: JSON.stringify(fixture.reply) }] });
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") return void response.writeHead(200).end("ok");
  if (request.method === "GET" && request.url === "/calls") return send(response, 200, { count: calls.length, calls });
  if (request.method === "DELETE" && request.url === "/calls") {
    calls.length = 0;
    return void response.writeHead(204).end();
  }
  if (request.method === "POST" && request.url === "/v1/messages") return void messages(request, response);
  response.writeHead(404).end();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`model stub listening on ${port} with ${fixtures.size} fixtures`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
