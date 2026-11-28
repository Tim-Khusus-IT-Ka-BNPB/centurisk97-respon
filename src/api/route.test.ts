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
      { key: "DELETE /api/cases/:fileId/records/:recordId/videos/:videoId", policy: "caseTeam" },
      { key: "DELETE /api/desk/session", policy: "public" },
      { key: "DELETE /api/drafts/:draftId/photos/:photoId", policy: "reporter" },
      { key: "DELETE /api/drafts/:draftId/videos/:videoId", policy: "reporter" },
      { key: "DELETE /api/me/profiles/:profileId", policy: "reporter" },
      { key: "GET /api/auth/callback", policy: "public" },
      { key: "GET /api/auth/sign-in", policy: "public" },
      { key: "GET /api/cases/:fileId", policy: "caseTeam" },
      { key: "GET /api/cases/:fileId/media/:mediaId", policy: "caseTeam" },
      { key: "GET /api/cases/:fileId/records/:recordId/videos", policy: "caseTeam" },
      { key: "GET /api/cases/:fileId/records/:recordId/videos/:videoId", policy: "caseTeam" },
      { key: "GET /api/desk/cases", policy: "staff" },
      { key: "GET /api/desk/emergencies", policy: "staff" },
      { key: "GET /api/desk/map", policy: "staff" },
      { key: "GET /api/desk/missing", policy: "staff" },
      { key: "GET /api/desk/missing/:id", policy: "staff" },
      { key: "GET /api/desk/missing/:id/photo", policy: "staff" },
      { key: "GET /api/desk/photos", policy: "staff" },
      { key: "GET /api/desk/photos/:photoId", policy: "staff" },
      { key: "GET /api/desk/proofs/:proofId", policy: "staff" },
      { key: "GET /api/desk/reports", policy: "staff" },
      { key: "GET /api/desk/reports/:ticketNumber", policy: "staff" },
      { key: "GET /api/desk/reports/:ticketNumber/videos/:videoId", policy: "staff" },
      { key: "GET /api/desk/response", policy: "staff" },
      { key: "GET /api/desk/summary", policy: "staff" },
      { key: "GET /api/desk/warnings", policy: "staff" },
      { key: "GET /api/drafts/:draftId", policy: "reporter" },
      { key: "GET /api/drafts/:draftId/photos/:photoId", policy: "public" },
      { key: "GET /api/drafts/:draftId/videos", policy: "reporter" },
      { key: "GET /api/drafts/:draftId/videos/:videoId", policy: "reporter" },
      { key: "GET /api/education", policy: "public" },
      { key: "GET /api/emergencies/start", policy: "reporter" },
      { key: "GET /api/feed", policy: "public" },
      { key: "GET /api/feed/cards/:cardId/comments", policy: "public" },
      { key: "GET /api/feed/proofs/:proofId", policy: "public" },
      { key: "GET /api/feed/watch", policy: "public" },
      { key: "GET /api/health", policy: "public" },
      { key: "GET /api/me", policy: "public" },
      { key: "GET /api/missing/mine", policy: "reporter" },
      { key: "GET /api/outlook", policy: "public" },
      { key: "GET /api/places/districts/:code/villages", policy: "public" },
      { key: "GET /api/places/regencies/:code/villages", policy: "public" },
      { key: "GET /api/places/search", policy: "public" },
      { key: "GET /api/reports/:ticketNumber", policy: "reporter" },
      { key: "GET /api/reports/:ticketNumber/documents/:version/:format", policy: "public" },
      { key: "GET /api/reports/:ticketNumber/proofs/:proofId", policy: "public" },
      { key: "GET /api/today", policy: "public" },
      { key: "GET /api/warnings/key", policy: "public" },
      { key: "POST /api/case-links/:token", policy: "public" },
      { key: "POST /api/cases/:fileId/accept", policy: "staff" },
      { key: "POST /api/cases/:fileId/close", policy: "staff" },
      { key: "POST /api/cases/:fileId/fields", policy: "staff" },
      { key: "POST /api/cases/:fileId/members", policy: "staff" },
      { key: "POST /api/cases/:fileId/members/:memberId/link", policy: "staff" },
      { key: "POST /api/cases/:fileId/members/:memberId/remove", policy: "staff" },
      { key: "POST /api/cases/:fileId/nil", policy: "staff" },
      { key: "POST /api/cases/:fileId/records", policy: "caseTeam" },
      { key: "POST /api/cases/:fileId/records/:recordId", policy: "caseTeam" },
      { key: "POST /api/cases/:fileId/records/:recordId/cancel", policy: "caseTeam" },
      { key: "POST /api/cases/:fileId/records/:recordId/media", policy: "caseTeam" },
      { key: "POST /api/cases/:fileId/records/:recordId/reveal", policy: "staff" },
      { key: "POST /api/cases/:fileId/records/:recordId/videos", policy: "caseTeam" },
      { key: "POST /api/cases/:fileId/records/:recordId/videos/:videoId/complete", policy: "caseTeam" },
      { key: "POST /api/cases/:fileId/reopen", policy: "staff" },
      { key: "POST /api/consent", policy: "public" },
      { key: "POST /api/desk/aggregates", policy: "staff" },
      { key: "POST /api/desk/missing/:id/status", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/actions", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/case", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/checks", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/comment-figures/:figureId", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/comments/:commentId", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/documents", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/event/release", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/identity", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/officers/:profileId/number", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/proofs", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/proofs/:proofId/public", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/replies", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/status", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/take", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/today", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/tracking-link", policy: "staff" },
      { key: "POST /api/desk/reports/:ticketNumber/view", policy: "staff" },
      { key: "POST /api/desk/session", policy: "public" },
      { key: "POST /api/desk/warnings", policy: "staff" },
      { key: "POST /api/drafts", policy: "reporter" },
      { key: "POST /api/drafts/:draftId/photos", policy: "reporter" },
      { key: "POST /api/drafts/:draftId/send", policy: "reporter" },
      { key: "POST /api/drafts/:draftId/turns", policy: "reporter" },
      { key: "POST /api/drafts/:draftId/videos", policy: "reporter" },
      { key: "POST /api/drafts/:draftId/videos/:videoId/complete", policy: "reporter" },
      { key: "POST /api/emergencies", policy: "reporter" },
      { key: "POST /api/emergencies/:clientId/photos", policy: "reporter" },
      { key: "POST /api/feed/cards/:cardId/comments", policy: "reporter" },
      { key: "POST /api/feed/comments/:commentId/report", policy: "reporter" },
      { key: "POST /api/missing", policy: "reporter" },
      { key: "POST /api/preferences/language", policy: "public" },
      { key: "POST /api/preferences/theme", policy: "public" },
      { key: "POST /api/reports/:ticketNumber/follow-ups", policy: "reporter" },
      { key: "POST /api/reports/:ticketNumber/news", policy: "reporter" },
      { key: "POST /api/reports/:ticketNumber/rating", policy: "reporter" },
      { key: "POST /api/tracking", policy: "public" },
      { key: "POST /api/tracking/photos", policy: "public" },
      { key: "POST /api/warnings/status", policy: "public" },
      { key: "POST /api/warnings/stop", policy: "public" },
      { key: "PUT /api/cases/:fileId/records/:recordId/videos/:videoId/parts/:n", policy: "caseTeam" },
      { key: "PUT /api/drafts/:draftId/videos/:videoId/parts/:n", policy: "reporter" },
      { key: "PUT /api/warnings", policy: "public" },
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
      { key: "GET /api/bare", policy: null },
      { key: "GET /api/ok", policy: "public" },
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
  new Request("http://localhost/api/drafts/d1/turns", { method: "POST", headers, body: JSON.stringify(body) });

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
        profile: null,
      },
      post({ text: "air" }),
    );
    expect(response.status).toBe(404);
    expect(json?.error).toEqual({ code: "draft.notFound", copyKey: "error.draft.notFound", params: {} });
  });

  test("a write from another origin, with no origin or without the client header is refused", async () => {
    const device = { kind: "device", deviceId: "dev1" } as const;
    const { "x-respon-client": _, ...noClientHeader } = jsonWrite;
    const { origin: __, ...noOrigin } = jsonWrite;
    for (const headers of [{ ...jsonWrite, origin: "https://evil.example.test" }, noOrigin, noClientHeader]) {
      const { response, json } = await call(device, post({ text: "air" }, headers));
      expect(response.status).toBe(403);
      expect(json?.error).toEqual({ code: "request.refused", copyKey: "error.request.refused", params: {} });
    }
  });

  test("a request with no x-client-address is refused, a spoofed x-forwarded-for is ignored", async () => {
    const { "x-client-address": _, ...noAddress } = jsonWrite;
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
      new Request("http://localhost/api/nothing", { headers: fromBrowser }),
    );
    expect(response.status).toBe(404);
    expect(json?.error).toMatchObject({ code: "request.refused" });
  });

  test("an unexpected error answers 503 and logs no detail", async () => {
    const { response, json, lines } = await call(
      undefined,
      new Request("http://localhost/api/boom", { headers: fromBrowser }),
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
        routeId: "POST /api/drafts/:draftId/turns",
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
      new Request("http://localhost/api/health", { headers: fromBrowser }),
      bindings,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});

describe("response schemas and the OpenAPI document", () => {
  test("every response of every route declares its body, only 204 and 302 have none", () => {
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
      "/api/auth/callback",
      "/api/auth/sign-in",
      "/api/case-links/{token}",
      "/api/cases/{fileId}",
      "/api/cases/{fileId}/accept",
      "/api/cases/{fileId}/close",
      "/api/cases/{fileId}/fields",
      "/api/cases/{fileId}/media/{mediaId}",
      "/api/cases/{fileId}/members",
      "/api/cases/{fileId}/members/{memberId}/link",
      "/api/cases/{fileId}/members/{memberId}/remove",
      "/api/cases/{fileId}/nil",
      "/api/cases/{fileId}/records",
      "/api/cases/{fileId}/records/{recordId}",
      "/api/cases/{fileId}/records/{recordId}/cancel",
      "/api/cases/{fileId}/records/{recordId}/media",
      "/api/cases/{fileId}/records/{recordId}/reveal",
      "/api/cases/{fileId}/records/{recordId}/videos",
      "/api/cases/{fileId}/records/{recordId}/videos/{videoId}",
      "/api/cases/{fileId}/records/{recordId}/videos/{videoId}/complete",
      "/api/cases/{fileId}/records/{recordId}/videos/{videoId}/parts/{n}",
      "/api/cases/{fileId}/reopen",
      "/api/consent",
      "/api/desk/aggregates",
      "/api/desk/cases",
      "/api/desk/emergencies",
      "/api/desk/map",
      "/api/desk/missing",
      "/api/desk/missing/{id}",
      "/api/desk/missing/{id}/photo",
      "/api/desk/missing/{id}/status",
      "/api/desk/photos",
      "/api/desk/photos/{photoId}",
      "/api/desk/proofs/{proofId}",
      "/api/desk/reports",
      "/api/desk/reports/{ticketNumber}",
      "/api/desk/reports/{ticketNumber}/actions",
      "/api/desk/reports/{ticketNumber}/case",
      "/api/desk/reports/{ticketNumber}/checks",
      "/api/desk/reports/{ticketNumber}/comment-figures/{figureId}",
      "/api/desk/reports/{ticketNumber}/comments/{commentId}",
      "/api/desk/reports/{ticketNumber}/documents",
      "/api/desk/reports/{ticketNumber}/event/release",
      "/api/desk/reports/{ticketNumber}/identity",
      "/api/desk/reports/{ticketNumber}/officers/{profileId}/number",
      "/api/desk/reports/{ticketNumber}/proofs",
      "/api/desk/reports/{ticketNumber}/proofs/{proofId}/public",
      "/api/desk/reports/{ticketNumber}/replies",
      "/api/desk/reports/{ticketNumber}/status",
      "/api/desk/reports/{ticketNumber}/take",
      "/api/desk/reports/{ticketNumber}/today",
      "/api/desk/reports/{ticketNumber}/tracking-link",
      "/api/desk/reports/{ticketNumber}/videos/{videoId}",
      "/api/desk/reports/{ticketNumber}/view",
      "/api/desk/response",
      "/api/desk/session",
      "/api/desk/summary",
      "/api/desk/warnings",
      "/api/drafts",
      "/api/drafts/{draftId}",
      "/api/drafts/{draftId}/photos",
      "/api/drafts/{draftId}/photos/{photoId}",
      "/api/drafts/{draftId}/send",
      "/api/drafts/{draftId}/turns",
      "/api/drafts/{draftId}/videos",
      "/api/drafts/{draftId}/videos/{videoId}",
      "/api/drafts/{draftId}/videos/{videoId}/complete",
      "/api/drafts/{draftId}/videos/{videoId}/parts/{n}",
      "/api/education",
      "/api/emergencies",
      "/api/emergencies/start",
      "/api/emergencies/{clientId}/photos",
      "/api/feed",
      "/api/feed/cards/{cardId}/comments",
      "/api/feed/comments/{commentId}/report",
      "/api/feed/proofs/{proofId}",
      "/api/feed/watch",
      "/api/health",
      "/api/me",
      "/api/me/profiles/{profileId}",
      "/api/missing",
      "/api/missing/mine",
      "/api/outlook",
      "/api/places/districts/{code}/villages",
      "/api/places/regencies/{code}/villages",
      "/api/places/search",
      "/api/preferences/language",
      "/api/preferences/theme",
      "/api/reports/{ticketNumber}",
      "/api/reports/{ticketNumber}/documents/{version}/{format}",
      "/api/reports/{ticketNumber}/follow-ups",
      "/api/reports/{ticketNumber}/news",
      "/api/reports/{ticketNumber}/proofs/{proofId}",
      "/api/reports/{ticketNumber}/rating",
      "/api/today",
      "/api/tracking",
      "/api/tracking/photos",
      "/api/warnings",
      "/api/warnings/key",
      "/api/warnings/status",
      "/api/warnings/stop",
    ]);
    const turns = document.paths?.["/api/drafts/{draftId}/turns"]?.post?.responses ?? {};
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
    const search = document.paths?.["/api/places/search"]?.get?.responses ?? {};
    expect(Object.keys(search).sort()).toEqual(["200", "400", "404", "422", "429", "503"]);
  });
});
