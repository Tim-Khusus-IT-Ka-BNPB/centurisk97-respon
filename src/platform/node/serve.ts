import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getRequestListener, type HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp, type PageHandler, readSettings } from "../app";
import { connect } from "../postgres";
import { photoStoreOf } from "../services";

const QUARTER_HOUR_MS = 15 * 60 * 1000;

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

export type ServeOptions = {
  readonly pages: PageHandler;
  // Vite's, in development; null when the built files in build/client are served.
  readonly middleware: Middleware | null;
  readonly onStop?: () => Promise<void>;
};

// respon on Node, beside its Postgres and Garage (decisions 0014 and 0015 in centurisk97-platform):
// the pages, the API and the built files on one port, and the run every 15 minutes.
export async function serve({ pages, middleware, onStop }: ServeOptions): Promise<void> {
  const started = readSettings(process.env);
  if (started === null) process.exit(1);
  const { settings, log } = started;
  const database = await connect(settings.databaseUrl);
  const app = createApp({ ...started, db: database.db, photos: photoStoreOf(settings), pages, runtime: "node" });

  // Each request as the site's own address names it, behind Caddy's TLS. The client's address is
  // the header Caddy sets on the server; on one's own machine and in the browser tests, the socket's.
  const fromSocket = settings.appEnv === "local" || settings.appEnv === "test";
  const addressed = (request: Request, socketAddress: string | undefined): Request => {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    if (fromSocket) headers.set("x-client-address", (socketAddress ?? "").replace(/^::ffff:/, ""));
    const init: RequestInit & { duplex?: "half" } = { method: request.method, headers, signal: request.signal };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      init.duplex = "half";
    }
    return new Request(new URL(`${url.pathname}${url.search}`, settings.appOrigin), init);
  };

  const web = new Hono<{ Bindings: HttpBindings }>();
  if (middleware === null) {
    // Hashed names: a file under assets/ never changes, so browsers keep it a year.
    web.use(
      "/assets/*",
      serveStatic({
        root: "./build/client",
        onFound: (_path, c) => c.header("cache-control", "public, max-age=31536000, immutable"),
      }),
    );
    web.use("*", serveStatic({ root: "./build/client" }));
  }
  web.all("*", (c) => app.fetch(addressed(c.req.raw, c.env.incoming.socket.remoteAddress)));

  const listener = getRequestListener(web.fetch);
  const server = createServer((request, response) => {
    if (middleware === null) void listener(request, response);
    else middleware(request, response, () => void listener(request, response));
  });
  server.listen(Number(process.env.PORT ?? "3000"), process.env.HOST ?? "127.0.0.1", () =>
    log.info({ event: "server.started" }),
  );

  // On each quarter hour, as the old cron trigger was; a run still going skips the next.
  let running = false;
  const runScheduled = async () => {
    if (running) return;
    running = true;
    await app.scheduled().catch(() => undefined);
    running = false;
  };
  let every: NodeJS.Timeout | undefined;
  const first = setTimeout(
    () => {
      void runScheduled();
      every = setInterval(() => void runScheduled(), QUARTER_HOUR_MS);
    },
    QUARTER_HOUR_MS - (Date.now() % QUARTER_HOUR_MS),
  );

  const stop = () => {
    clearTimeout(first);
    clearInterval(every);
    server.close(() => {
      void Promise.all([database.close(), onStop?.()]).then(() => process.exit(0));
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
