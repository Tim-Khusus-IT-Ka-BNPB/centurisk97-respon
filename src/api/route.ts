import { OpenAPIHono, type RouteConfig, type RouteHandler, type z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import { errorEnvelopeSchema } from "../contract/errors";
import { clientAddress } from "../platform/address";
import { sqlState } from "../platform/database";
import type { Principal } from "../ports/identity";
import { admitCall } from "../services/gateway";
import type { ApiEnv } from "./context";
import { refuse } from "./envelope";

// Who may call a route. "reporter" needs a device or session principal; a draft it does not own
// answers 404 inside the handler, the same as a draft that does not exist. "staff" needs a staff
// account; what it may do there is decided in the service, by role and region.
// "gateway" is a WhatsApp gateway: it signs each call and no cookie or Origin speaks for it.
export type Policy = "public" | "reporter" | "staff" | "gateway";

export const API_BASE = "/api/lapor";
const MAX_BODY_BYTES = 16 * 1024;
// A photo upload: 2.5 MB is the photo rule, and a page with no script cannot shrink a camera
// file first, so the route takes more and the photo check names the size.
const PHOTO_BODY_BYTES = 12 * 1024 * 1024;
const isPhotoUpload = (method: string, path: string) =>
  (method === "POST" && /\/(?:drafts\/[^/]+\/photos|desk\/reports\/[^/]+\/proofs|foto)$/.test(path)) ||
  (method === "PUT" && /\/drafts\/[^/]+\/videos\/[^/]+\/parts\/\d+$/.test(path));
// Upstream's route shapes for its gateway (ROADMAP section 7), kept as they are.
export const isGatewayPath = (path: string) => /^\/api\/lapor\/(?:pesan|foto|izin|bahasa|kabar(?:\/.+)?)$/.test(path);
const READ_METHODS = new Set(["GET", "HEAD"]);

export type Api = {
  readonly app: OpenAPIHono<ApiEnv>;
  readonly policies: ReadonlyMap<string, Policy>;
};

const routeKey = (method: string, path: string) => `${method.toUpperCase()} ${path}`;
const honoPath = (openApiPath: string) => `${API_BASE}${openApiPath.replace(/\{(\w+)\}/g, ":$1")}`;

const responseHeaders = createMiddleware<ApiEnv>(async (c, next) => {
  const started = Date.now();
  await next();
  c.header("cache-control", "private, no-store");
  c.header("referrer-policy", "no-referrer");
  c.env.log.info({
    event: "request",
    routeId: `${c.req.method} ${routePath(c, -1)}`,
    method: c.req.method,
    status: c.res.status,
    durationMs: Date.now() - started,
  });
});

// The client address comes from cf-connecting-ip only; a request without it is refused.
const addressCheck = createMiddleware<ApiEnv>(async (c, next) => {
  const address = clientAddress(c.req.raw.headers, c.env.settings.addressFallback);
  if (address === null) return refuse(c, 400, "request.refused");
  c.set("address", address);
  await next();
});

// Writes must come from our own origin and, for JSON, carry the client header a cross-site form cannot set.
// A gateway is no browser: its signature is checked by its routes' policy.
const writeCheck = createMiddleware<ApiEnv>(async (c, next) => {
  if (!READ_METHODS.has(c.req.method) && !isGatewayPath(c.req.path)) {
    const sameOrigin = c.req.header("origin") === c.env.settings.appOrigin;
    if (!sameOrigin || c.req.header("x-lapor-client") !== "1") return refuse(c, 403, "request.refused");
  }
  await next();
});

// A signed call, once. A write that fails on our side gives its message id back, so the gateway may
// send it again.
const gatewayGuard = createMiddleware<ApiEnv>(async (c, next) => {
  const url = new URL(c.req.url);
  const call = await admitCall(c.env, {
    method: c.req.method,
    path: `${url.pathname}${url.search}`,
    header: (name) => c.req.header(name),
    body: new Uint8Array(await c.req.arrayBuffer()),
    once: !READ_METHODS.has(c.req.method),
  });
  if (call.kind === "refused") return refuse(c, 401, "gateway.refused");
  if (call.kind === "replayed") return refuse(c, 409, "gateway.replayed");
  c.set("gatewayId", call.gatewayId);
  await next();
  if (c.res.status === 503) await call.giveBack();
});

function policyGuard(policy: Policy) {
  if (policy === "gateway") return gatewayGuard;
  return createMiddleware<ApiEnv>(async (c, next) => {
    if (policy === "reporter") {
      const principal = c.var.principal as Principal | undefined;
      if (principal === undefined || principal.kind === "anonymous") return refuse(c, 401, "auth.signInFirst");
      if (principal.kind === "staff") return refuse(c, 404, "draft.notFound");
    }
    if (policy === "staff" && c.var.principal?.kind !== "staff") return refuse(c, 401, "auth.staffSignInFirst");
    await next();
  });
}

export function createApi(): Api {
  const app = new OpenAPIHono<ApiEnv>({
    // A body or query that does not match the route's schema is malformed.
    defaultHook: (result, c) => (result.success ? undefined : refuse(c, 400, "request.refused")),
  }).basePath(API_BASE);
  app.use("*", responseHeaders, addressCheck, writeCheck);
  const tooLarge = (c: Parameters<typeof refuse>[0]) => refuse(c, 413, "request.tooLarge");
  const small = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge });
  const photo = bodyLimit({ maxSize: PHOTO_BODY_BYTES, onError: tooLarge });
  app.use("*", (c, next) => (isPhotoUpload(c.req.method, c.req.path) ? photo(c, next) : small(c, next)));
  app.notFound((c) => refuse(c, 404, "request.refused"));
  app.onError((error, c) => {
    const state = sqlState(error);
    c.env.log.error({ event: "request.failed", errorCode: "unexpected", ...(state ? { sqlState: state } : {}) });
    return refuse(c, 503, "request.unavailable");
  });
  return { app, policies: new Map() };
}

// A required JSON request body of this schema.
export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  content: { "application/json": { schema } },
  required: true,
});

// A response with a JSON body of this schema.
export const jsonResponse = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { "application/json": { schema } },
});

export const refusal = (description: string) => jsonResponse(description, errorEnvelopeSchema);

// The refusals the shared checks can give on any route, so the document lists them too.
function sharedResponses(method: string, policy: Policy) {
  return {
    400: refusal("Malformed request, or no client address"),
    503: refusal("A dependency is down"),
    ...(READ_METHODS.has(method.toUpperCase())
      ? {}
      : { 403: refusal("Not sent from this site"), 413: refusal("Body over 16 KB, or 12 MB for a photo") }),
    ...(policy === "reporter" ? { 401: refusal("No reporter"), 404: refusal("Not found for this reporter") } : {}),
    ...(policy === "gateway"
      ? { 401: refusal("Not signed by a known gateway, or not now"), 409: refusal("The message id was used before") }
      : {}),
    ...(policy === "staff"
      ? {
          401: refusal("No staff account"),
          403: refusal("Not sent from this site, or not allowed for this account"),
          404: refusal("No such report for this account"),
          429: refusal("Over this account's hourly desk limit"),
        }
      : {}),
  };
}

// Handlers answer with the error envelope through refuse(), so they return plain responses;
// the declared response schemas are checked by the document test instead of by the compiler.
type Handler<R extends RouteConfig> = (c: Parameters<RouteHandler<R, ApiEnv>>[0]) => Response | Promise<Response>;

// The only way to add a route: it must name its policy, and the route list test fails on any
// route registered without one.
export function addRoute<R extends RouteConfig>(api: Api, policy: Policy, config: R, handler: Handler<R>) {
  (api.policies as Map<string, Policy>).set(routeKey(config.method, honoPath(config.path)), policy);
  const responses = { ...sharedResponses(config.method, policy), ...config.responses };
  api.app.openapi(
    { ...config, responses, middleware: [policyGuard(policy)] } as R,
    handler as unknown as RouteHandler<R, ApiEnv>,
  );
}

// Routes with a response that declares no body schema; only 204 has no body.
export function responsesWithoutSchema(api: Api): string[] {
  const missing: string[] = [];
  const routes = api.app.openAPIRegistry.definitions.flatMap((definition) =>
    definition.type === "route" ? [definition.route] : [],
  );
  for (const route of routes) {
    for (const [status, response] of Object.entries(route.responses)) {
      if (status !== "204" && !("content" in response && response.content))
        missing.push(`${route.method.toUpperCase()} ${route.path} ${status}`);
    }
  }
  return missing;
}

// The OpenAPI document of every route, generated from the route declarations.
export function openApiDocument(api: Api): ReturnType<Api["app"]["getOpenAPI31Document"]> {
  return api.app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "Lapor Bencana reporting API", version: "1" },
  });
}

export type RouteEntry = { readonly key: string; readonly policy: Policy | null };

// Every route the app answers, with the policy it was declared with.
export function routeList(api: Api): RouteEntry[] {
  const keys = new Set(
    api.app.routes.filter((route) => route.method !== "ALL").map((route) => routeKey(route.method, route.path)),
  );
  return [...keys].sort().map((key) => ({ key, policy: api.policies.get(key) ?? null }));
}
