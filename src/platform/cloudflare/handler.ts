import type { AppLoadContext } from "react-router";
import { r2PhotoStore } from "../../adapters/r2/photoStore";
import { api } from "../../api/app";
import { createBridge } from "../../api/bridge";
import { runSweep } from "../../services/sweep";
import { sendWarnings } from "../../services/warningSend";
import { createClock } from "../clock";
import { sqlState } from "../database";
import { createLogger, type Logger, type LogSink } from "../log";
import { createServices } from "../services";
import { parseSettings, type Settings, SettingsError } from "../settings";

type PageHandler = (request: Request, context: AppLoadContext) => Promise<Response>;

type Instance = { readonly settings: Settings; readonly log: Logger; readonly clock: ReturnType<typeof createClock> };
type Started = { readonly ok: true; readonly instance: Instance } | { readonly ok: false };

// Settings are read once per Worker instance. A bad setting refuses every request and is logged by name.
function start(env: Env, sink: LogSink | undefined): Started {
  try {
    const settings = parseSettings(env as unknown as Record<string, unknown>, env.DB !== undefined);
    return {
      ok: true,
      instance: { settings, log: createLogger(settings.logLevel, sink), clock: createClock(settings.clockFixedMs) },
    };
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    createLogger("info", sink).error({
      event: "settings.refused",
      settings: error.problems.map((problem) => problem.setting),
    });
    return { ok: false };
  }
}

function withPageHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  // Same origin: nothing leaves the site, and the bridge can still check a page post's Origin.
  headers.set("referrer-policy", "same-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function createWorker(pages: PageHandler, runtime: string, sink?: LogSink) {
  const started = new WeakMap<Env, Started>();
  const startOnce = (env: Env): Started => {
    let state = started.get(env);
    if (!state) {
      state = start(env, sink);
      started.set(env, state);
    }
    return state;
  };
  return {
    async fetch(request, env, ctx) {
      const state = startOnce(env);
      if (!state.ok) return new Response(null, { status: 503, headers: { "referrer-policy": "no-referrer" } });
      const { settings, log, clock } = state.instance;
      const bindings = createServices(settings, log, env.DB, env.PHOTOS, clock);
      const fetchApi = async (apiRequest: Request) => api.app.fetch(apiRequest, bindings, ctx);
      if (new URL(request.url).pathname.startsWith("/api/")) return fetchApi(request);
      const context = {
        runtime,
        origin: settings.appOrigin,
        api: createBridge(fetchApi, settings.appOrigin, request),
      };
      return withPageHeaders(await pages(request, context));
    },
    // The cron trigger: the sweep, then the warnings. A bad setting refuses the run as it refuses requests.
    async scheduled(_controller, env) {
      const state = startOnce(env);
      if (!state.ok) return;
      const { settings, log, clock } = state.instance;
      let step = "sweep";
      try {
        await runSweep(env.DB, r2PhotoStore(env.PHOTOS), clock, log);
        step = "warnings";
        const started = Date.now();
        await sendWarnings({ db: env.DB, settings, clock }, (request) => fetch(request));
        log.info({ event: "warnings.done", durationMs: Date.now() - started });
      } catch (error) {
        // The driver's message may quote values, so only its SQLite code leaves this run.
        const code = sqlState(error);
        log.error({ event: `${step}.failed`, errorCode: `${step}.failed`, ...(code ? { sqlState: code } : {}) });
        throw new Error(`Scheduled ${step} failed`);
      }
    },
  } satisfies ExportedHandler<Env>;
}
