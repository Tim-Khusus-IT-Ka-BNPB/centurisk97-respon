import type { AppLoadContext } from "react-router";
import { api } from "../../api/app";
import { createBridge } from "../../api/bridge";
import { runSweep } from "../../services/sweep";
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
      const bindings = createServices(settings, log, env.DB, clock);
      const fetchApi = async (apiRequest: Request) => api.app.fetch(apiRequest, bindings, ctx);
      if (new URL(request.url).pathname.startsWith("/api/")) return fetchApi(request);
      const context = {
        runtime,
        origin: settings.appOrigin,
        api: createBridge(fetchApi, settings.appOrigin, request),
      };
      return withPageHeaders(await pages(request, context));
    },
    // The cron trigger. A bad setting refuses the run as it refuses requests.
    async scheduled(_controller, env) {
      const state = startOnce(env);
      if (!state.ok) return;
      try {
        await runSweep(env.DB, state.instance.clock, state.instance.log);
      } catch (error) {
        // The driver's message may quote values, so only its SQLite code leaves this run.
        const code = sqlState(error);
        state.instance.log.error({
          event: "sweep.failed",
          errorCode: "sweep.failed",
          ...(code ? { sqlState: code } : {}),
        });
        throw new Error("Scheduled sweep failed");
      }
    },
  } satisfies ExportedHandler<Env>;
}
