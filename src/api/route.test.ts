import { createRoute, z } from "@hono/zod-openapi";
import { describe, expect, test } from "vitest";
import type { Principal } from "../ports/identity";
import { fromBrowser, jsonWrite, testBindings } from "../testing/api";
import { api } from "./app";
import { addRoute, createApi, jsonResponse, openApiDocument, responsesWithoutSchema, routeList } from "./route";

describe("route list", () => {
  test("every route of the app declares a policy", () => {
    const routes = routeList(api);
    expect(routes).toEqual([
      { key: "DELETE /api/lapor/desk/session", policy: "public" },
      { key: "DELETE /api/lapor/me/profiles/:profileId", policy: "reporter" },
      { key: "GET /api/lapor/desk/map", policy: "staff" },
      { key: "GET /api/lapor/desk/photos", policy: "staff" },
      { key: "GET /api/lapor/desk/photos/:photoId", policy: "staff" },
      { key: "GET /api/lapor/desk/reports", policy: "staff" },
      { key: "GET /api/lapor/desk/reports/:ticketNumber", policy: "staff" },
      { key: "GET /api/lapor/desk/summary", policy: "staff" },
      { key: "GET /api/lapor/drafts/:draftId", policy: "reporter" },
      { key: "GET /api/lapor/drafts/:draftId/photos/:photoId", policy: "public" },
      { key: "GET /api/lapor/education", policy: "public" },
      { key: "GET /api/lapor/health", policy: "public" },
      { key: "GET /api/lapor/me", policy: "public" },
      { key: "GET /api/lapor/places/districts/:code/villages", policy: "public" },
      { key: "GET /api/lapor/places/regencies/:code/villages", policy: "public" },
      { key: "GET /api/lapor/places/search", policy: "public" },
      { key: "POST /api/lapor/consent", policy: "public" },
      { key: "POST /api/lapor/desk/reports/:ticketNumber/view", policy: "staff" },
      { key: "POST /api/lapor/desk/session", policy: "public" },
      { key: "POST /api/lapor/drafts", policy: "reporter" },
      { key: "POST /api/lapor/drafts/:draftId/photos", policy: "reporter" },
      { key: "POST /api/lapor/drafts/:draftId/send", policy: "reporter" },
      { key: "POST /api/lapor/drafts/:draftId/turns", policy: "reporter" },
      { key: "POST /api/lapor/preferences/theme", policy: "public" },
      { key: "POST /api/lapor/reports/:ticketNumber/rating", policy: "reporter" },
      { key: "POST /api/lapor/tracking", policy: "public" },
    ]);
    expect(routes.filter((route) => route.policy === null)).toEqual([]);
  });

  test("a route added without the helper shows up with no policy", () => {
    const probe = createApi();
    addRoute(
      probe,
      "public",
      createRoute({ method: "get", path: "/ok", responses: { 200: { description: "ok" } } }),
      (c) => c.body(null, 200),
    );
    probe.app.get("/bare", (c) => c.text("no policy"));
    expect(routeList(probe)).toEqual([
      { key: "GET /api/lapor/bare", policy: null },
      { key: "GET /api/lapor/ok", policy: "public" },
    ]);
  });
});

function probeApi(principal?: Principal) {
  const probe = createApi();
  if (principal) {
    probe.app.use("*", async (c, next) => {
      c.set("principal", principal);
      await next();
    });
  }
  addRoute(
    probe,
    "reporter",
    createRoute({
      method: "post",
      path: "/drafts/{draftId}/turns",
      request: {
        params: z.object({ draftId: z.string() }),
        body: { content: { "application/json": { schema: z.object({ text: z.string() }) } } },
      },
      responses: {
        200: { description: "ok", content: { "application/json": { schema: z.object({ echo: z.string() }) } } },
      },
    }),
    (c) => c.json({ echo: `${c.req.valid("param").draftId}:${c.req.valid("json").text}:${c.var.address}` }, 200),
  );
  addRoute(
    probe,
    "public",
    createRoute({ method: "get", path: "/boom", responses: { 200: { description: "never" } } }),
    () => {
      throw new Error("database said Uji Satu");
    },
  );
  return probe;
}

const post = (body: unknown, headers: Record<string, string> = jsonWrite) =>
  new Request("http://localhost/api/lapor/drafts/d1/turns", { method: "POST", headers, body: JSON.stringify(body) });

async function call(principal: Principal | undefined, request: Request, overrides: Record<string, string> = {}) {
  const { bindings, lines } = testBindings(overrides);
  const response = await probeApi(principal).app.fetch(request, bindings);
  return { response, lines, json: (await response.json().catch(() => null)) as Record<string, unknown> | null };
}

describe("policy, origin, address and size checks", () => {
  test("a reporter route runs for a device or session principal", async () => {
    for (const principal of [
      { kind: "device", deviceId: "dev1" },
      { kind: "session", reporterId: "r1" },
    ] as const) {
      const { response, json } = await call(principal, post({ text: "air" }));
      expect(response.status).toBe(200);
      expect(json).toEqual({ echo: "d1:air:198.51.100.2" });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });

  test("no principal or an anonymous one gets 401 with the sign-in copy", async () => {
    for (const principal of [undefined, { kind: "anonymous" } as const]) {
      const { response, json } = await call(principal, post({ text: "air" }));
      expect(response.status).toBe(401);
      expect(json).toEqual({
        error: { code: "auth.signInFirst", copyKey: "error.auth.signInFirst", params: {} },
        fields: [],
        retryAt: null,
        draft: null,
      });
    }
  });

  test("staff gets 404 like a draft that does not exist", async () => {
    const { response, json } = await call(
      {
        kind: "staff",
        staffId: "staff-desk-1",
        role: "deskOfficer",
        label: "Petugas Uji",
        scope: { level: "national" },
      },
      post({ text: "air" }),
    );
    expect(response.status).toBe(404);
    expect(json?.error).toEqual({ code: "draft.notFound", copyKey: "error.draft.notFound", params: {} });
  });

  test("a write from another origin, with no origin or without the client header is refused", async () => {
    const device = { kind: "device", deviceId: "dev1" } as const;
    const { "x-lapor-client": _, ...noClientHeader } = jsonWrite;
    const { origin: __, ...noOrigin } = jsonWrite;
    for (const headers of [{ ...jsonWrite, origin: "https://evil.example.test" }, noOrigin, noClientHeader]) {
      const { response, json } = await call(device, post({ text: "air" }, headers));
      expect(response.status).toBe(403);
      expect(json?.error).toEqual({ code: "request.refused", copyKey: "error.request.refused", params: {} });
    }
  });

  test("a request with no cf-connecting-ip is refused, a spoofed x-forwarded-for is ignored", async () => {
    const { "cf-connecting-ip": _, ...noAddress } = jsonWrite;
    const refused = await call(
      { kind: "device", deviceId: "dev1" },
      post({ text: "air" }, { ...noAddress, "x-forwarded-for": "10.0.0.1" }),
    );
    expect(refused.response.status).toBe(400);
    const fallback = await call({ kind: "device", deviceId: "dev1" }, post({ text: "air" }, noAddress), {
      ADDRESS_FALLBACK: "loopback",
    });
    expect(fallback.json).toEqual({ echo: "d1:air:loopback" });
  });

  test("a body that does not match the schema is malformed", async () => {
    const { response, json } = await call({ kind: "device", deviceId: "dev1" }, post({ text: 3 }));
    expect(response.status).toBe(400);
    expect(json?.error).toMatchObject({ code: "request.refused" });
  });

  test("a body over 16 KB is refused before it is read", async () => {
    const atLimit = await call({ kind: "device", deviceId: "dev1" }, post({ text: "a".repeat(16 * 1024 - 11) }));
    expect(atLimit.response.status).toBe(200);
    const over = await call({ kind: "device", deviceId: "dev1" }, post({ text: "a".repeat(16 * 1024 - 10) }));
    expect(over.response.status).toBe(413);
    expect(over.json?.error).toMatchObject({ code: "request.tooLarge", copyKey: "error.request.tooLarge" });
  });

  test("an unknown address answers the envelope", async () => {
    const { response, json } = await call(
      undefined,
      new Request("http://localhost/api/lapor/nothing", { headers: fromBrowser }),
    );
    expect(response.status).toBe(404);
    expect(json?.error).toMatchObject({ code: "request.refused" });
  });

  test("an unexpected error answers 503 and logs no detail", async () => {
    const { response, json, lines } = await call(
      undefined,
      new Request("http://localhost/api/lapor/boom", { headers: fromBrowser }),
    );
    expect(response.status).toBe(503);
    expect(json?.error).toMatchObject({ code: "request.unavailable", copyKey: "error.request.unavailable" });
    expect(lines).toContainEqual({ event: "request.failed", errorCode: "unexpected" });
    expect(JSON.stringify(lines)).not.toContain("Uji");
  });

  test("each request is logged with its route, method, status and duration only", async () => {
    const { lines } = await call({ kind: "device", deviceId: "dev1" }, post({ text: "Uji Satu 0800 0000 0001" }));
    expect(lines).toEqual([
      {
        event: "request",
        routeId: "POST /api/lapor/drafts/:draftId/turns",
        method: "POST",
        status: 200,
        durationMs: expect.any(Number),
      },
    ]);
  });
});

describe("the health route", () => {
  test("answers ok to anyone", async () => {
    const { bindings } = testBindings();
    const response = await api.app.fetch(
      new Request("http://localhost/api/lapor/health", { headers: fromBrowser }),
      bindings,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});

describe("response schemas and the OpenAPI document", () => {
  test("every response of every route declares its body, only 204 has none", () => {
    expect(responsesWithoutSchema(api)).toEqual([]);
  });

  test("a route whose response has no body schema is named", () => {
    const probe = createApi();
    addRoute(
      probe,
      "public",
      createRoute({
        method: "get",
        path: "/bare",
        responses: { 200: { description: "no schema" }, 204: { description: "empty" } },
      }),
      (c) => c.body(null, 204),
    );
    addRoute(
      probe,
      "public",
      createRoute({ method: "get", path: "/typed", responses: { 200: jsonResponse("typed", z.object({})) } }),
      (c) => c.json({}, 200),
    );
    // A shared component schema is not a route, so it is not checked.
    probe.app.openAPIRegistry.register("Empty", z.object({}));
    expect(responsesWithoutSchema(probe)).toEqual(["GET /bare 200"]);
  });

  test("the document lists every route with its shared refusals, and is written for readers", async () => {
    const document = openApiDocument(api);
    // Node's file module, named at run time: this project is typed for the Worker, not for Node.
    const files = (await import("node:fs/promises" as string)) as {
      mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
      writeFile(path: string, text: string): Promise<void>;
    };
    await files.mkdir("build", { recursive: true });
    await files.writeFile("build/openapi.json", `${JSON.stringify(document, null, 2)}\n`);
    expect(document.openapi).toBe("3.1.0");
    const paths = Object.keys(document.paths ?? {}).sort();
    expect(paths).toEqual([
      "/api/lapor/consent",
      "/api/lapor/desk/map",
      "/api/lapor/desk/photos",
      "/api/lapor/desk/photos/{photoId}",
      "/api/lapor/desk/reports",
      "/api/lapor/desk/reports/{ticketNumber}",
      "/api/lapor/desk/reports/{ticketNumber}/view",
      "/api/lapor/desk/session",
      "/api/lapor/desk/summary",
      "/api/lapor/drafts",
      "/api/lapor/drafts/{draftId}",
      "/api/lapor/drafts/{draftId}/photos",
      "/api/lapor/drafts/{draftId}/photos/{photoId}",
      "/api/lapor/drafts/{draftId}/send",
      "/api/lapor/drafts/{draftId}/turns",
      "/api/lapor/education",
      "/api/lapor/health",
      "/api/lapor/me",
      "/api/lapor/me/profiles/{profileId}",
      "/api/lapor/places/districts/{code}/villages",
      "/api/lapor/places/regencies/{code}/villages",
      "/api/lapor/places/search",
      "/api/lapor/preferences/theme",
      "/api/lapor/reports/{ticketNumber}/rating",
      "/api/lapor/tracking",
    ]);
    const turns = document.paths?.["/api/lapor/drafts/{draftId}/turns"]?.post?.responses ?? {};
    expect(Object.keys(turns).sort()).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
      "410",
      "413",
      "422",
      "429",
      "503",
    ]);
    const search = document.paths?.["/api/lapor/places/search"]?.get?.responses ?? {};
    expect(Object.keys(search).sort()).toEqual(["200", "400", "404", "422", "429", "503"]);
  });
});
