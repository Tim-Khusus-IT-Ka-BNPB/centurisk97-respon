import type { AppLoadContext } from "react-router";
import { api } from "../api/app";
import { type ApiCall, createBridge } from "../api/bridge";
import type { Clock } from "../ports/clock";
import type { PhotoStore } from "../ports/photoStore";
import { runSweep } from "../services/sweep";
import { sendWarnings } from "../services/warningSend";
import { createClock } from "./clock";
import { type Database, sqlState } from "./database";
import { createLogger, type Logger, type LogSink } from "./log";
import { createServices } from "./services";
import { parseSettings, type Settings, SettingsError } from "./settings";

declare module "react-router" {
  interface AppLoadContext {
    runtime: string;
    // The site's address from the setting, for absolute canonical and share links.
    origin: string;
    // Hands a page loader or form action's call to the Hono route in the same process.
    api: ApiCall;
  }
}

export type PageHandler = (request: Request, context: AppLoadContext) => Promise<Response>;

// Settings are read once, at start. A bad one refuses the start and is logged by name, never by value.
export function readSettings(
  source: Readonly<Record<string, unknown>>,
  sink?: LogSink,
): { readonly settings: Settings; readonly log: Logger; readonly clock: Clock } | null {
  try {
    const settings = parseSettings(source);
    return { settings, log: createLogger(settings.logLevel, sink), clock: createClock(settings.clockFixedMs) };
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    createLogger("info", sink).error({
      event: "settings.refused",
      settings: error.problems.map((problem) => problem.setting),
    });
    return null;
  }
}

function withPageHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  // Same origin: nothing leaves the site, and the bridge can still check a page post's Origin.
  headers.set("referrer-policy", "same-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export type AppParts = {
  readonly settings: Settings;
  readonly log: Logger;
  readonly clock: Clock;
  readonly db: Database;
  readonly photos: PhotoStore;
  readonly pages: PageHandler;
  // Names the server in the pages' context: "node", or the test's own.
  readonly runtime: string;
};

// respon as one fetch for every request, and the run every 15 minutes.
export function createApp({ settings, log, clock, db, photos, pages, runtime }: AppParts) {
  const bindings = createServices(settings, log, db, photos, clock);
  const fetchApi = async (apiRequest: Request) => api.app.fetch(apiRequest, bindings);
  return {
    async fetch(request: Request): Promise<Response> {
      if (new URL(request.url).pathname.startsWith("/api/")) return fetchApi(request);
      const context = { runtime, origin: settings.appOrigin, api: createBridge(fetchApi, settings.appOrigin, request) };
      return withPageHeaders(await pages(request, context));
    },
    // The sweep, then the warnings. A failure is logged by its step and SQL state, and fails the run.
    async scheduled(): Promise<void> {
      let step = "sweep";
      try {
        await runSweep(db, photos, clock, log);
        step = "warnings";
        const started = Date.now();
        await sendWarnings({ db, settings, clock }, fetch.bind(globalThis));
        log.info({ event: "warnings.done", durationMs: Date.now() - started });
      } catch (error) {
        // The driver's message may quote values, so only its SQL state leaves this run.
        const code = sqlState(error);
        log.error({ event: `${step}.failed`, errorCode: `${step}.failed`, ...(code ? { sqlState: code } : {}) });
        throw new Error(`Scheduled ${step} failed`);
      }
    },
  };
}
