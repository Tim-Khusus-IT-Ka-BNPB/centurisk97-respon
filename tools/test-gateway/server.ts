import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { createGateway, numberOf } from "./gateway.ts";

// The test gateway: stands in for the WhatsApp gateway on this machine alone. A walk writes as a
// number and reads from its chat what that number would receive; nothing ever reaches WhatsApp.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Setting ${name} is missing. Copy it from .env.example into .env.`);
  return value;
}

// Set to 0 to pull only when POST /api/pull asks.
const PULL_MS = Number(process.env.TEST_GATEWAY_PULL_MS ?? "5000");
const port = Number(process.env.TEST_GATEWAY_PORT ?? "8791");
const gateway = createGateway({
  app: process.env.TEST_GATEWAY_APP ?? "http://localhost:5173",
  id: required("TEST_GATEWAY_ID"),
  secret: required("TEST_GATEWAY_SECRET"),
  owner: numberOf(process.env.TEST_GATEWAY_OWNER ?? "0800 0000 0000") ?? "",
});

const PAGE = {
  "/": ["page.html", "text/html; charset=utf-8"],
  "/page.css": ["page.css", "text/css; charset=utf-8"],
  "/page.js": ["page.js", "text/javascript; charset=utf-8"],
} as const;

type Sent = {
  readonly number?: string;
  readonly text?: string;
  readonly location?: { readonly lat: number; readonly lon: number };
  readonly photo?: string;
  readonly messageId?: string;
};

async function bodyOf(request: IncomingMessage): Promise<Sent> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Sent;
}

const json = (response: ServerResponse, status: number, body: unknown) =>
  void response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

async function send(request: IncomingMessage, response: ServerResponse) {
  const sent = await bodyOf(request);
  const number = numberOf(sent.number ?? "");
  if (number === null) return json(response, 400, { error: "Only numbers that begin with 0800" });
  let status: number;
  if (sent.photo !== undefined) status = await gateway.photo(number, sent.photo, sent.text ?? "");
  else if (sent.location) status = await gateway.share(number, sent.location.lat, sent.location.lon);
  else status = await gateway.say(number, sent.text ?? "", sent.messageId);
  json(response, 200, { status, chat: gateway.chats.get(number) ?? [] });
}

function file(response: ServerResponse, id: string) {
  const found = gateway.files.get(id);
  if (!found) return json(response, 404, {});
  const headers = {
    "content-type": found.mime,
    "content-disposition": `inline; filename="${found.name}"`,
    "x-content-type-options": "nosniff",
  };
  response.writeHead(200, headers).end(found.bytes);
}

async function route(request: IncomingMessage, response: ServerResponse) {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  const page = PAGE[pathname as keyof typeof PAGE];
  if (request.method === "GET" && page)
    return void response
      .writeHead(200, { "content-type": page[1] })
      .end(readFileSync(join(import.meta.dirname, page[0])));
  if (request.method === "GET" && pathname === "/health") return void response.writeHead(200).end("ok");
  if (request.method === "GET" && pathname === "/api/outbox")
    return json(response, 200, { chats: Object.fromEntries(gateway.chats), calls: gateway.calls.slice(-50) });
  if (request.method === "GET" && pathname.startsWith("/api/files/")) return file(response, pathname.slice(11));
  // A page elsewhere cannot make this machine send: JSON is asked for, which a form cannot post.
  if (request.method === "POST" && !/^application\/json/.test(request.headers["content-type"] ?? ""))
    return json(response, 415, {});
  if (request.method === "POST" && pathname === "/api/send") return send(request, response);
  if (request.method === "POST" && pathname === "/api/pull") return json(response, 200, { sent: await gateway.pull() });
  json(response, 404, {});
}

const server = createServer((request, response) => {
  route(request, response).catch(() => json(response, 500, {}));
});

// The real gateway comes once a minute; a walk need not wait that long.
const pulling = PULL_MS > 0 ? setInterval(() => void gateway.pull().catch(() => 0), PULL_MS) : undefined;

server.listen(port, "127.0.0.1", () => console.log(`test gateway listening on http://127.0.0.1:${port}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(pulling);
    server.close(() => process.exit(0));
  });
}
