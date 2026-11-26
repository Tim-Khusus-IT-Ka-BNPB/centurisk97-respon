import { createRoute, z } from "@hono/zod-openapi";
import { ALL_HAZARDS, MAX_DISTRICTS, pushEndpointOk, pushKeysOk } from "../../domain/warnings";
import { chooseWarnings, stopChoice, warningsOf } from "../../services/warnings";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { limitRefused } from "./shared";

// The push service's address travels in a body, never in an address a log could keep.
const phone = z.object({ endpoint: z.string().refine(pushEndpointOk) });

const choiceBody = phone.extend({
  keys: z.object({ p256dh: z.string(), auth: z.string() }).refine((keys) => pushKeysOk(keys.p256dh, keys.auth)),
  districts: z
    .array(z.string().regex(/^\d{2}\.\d{2}\.\d{2}$/))
    .min(1)
    .max(MAX_DISTRICTS)
    .refine((codes) => new Set(codes).size === codes.length),
  hazards: z.number().int().min(1).max(ALL_HAZARDS),
  threshold: z.number().int().min(1).max(3),
});

const viewSchema = z.object({
  districts: z.array(z.object({ code: z.string(), name: z.string() })),
  hazards: z.number().int().nullable(),
  threshold: z.number().int().nullable(),
});

export function addWarningRoutes(api: Api): void {
  addRoute(
    api,
    "public",
    createRoute({
      method: "get",
      path: "/warnings/key",
      responses: {
        200: jsonResponse(
          "The key a phone subscribes with, or null while warnings are shut",
          z.object({ publicKey: z.string().nullable() }),
        ),
      },
    }),
    (c) => c.json({ publicKey: c.env.settings.push?.publicKey ?? null }, 200),
  );

  addRoute(
    api,
    "public",
    createRoute({
      method: "post",
      path: "/warnings/status",
      request: { body: jsonBody(phone) },
      responses: { 200: jsonResponse("What this phone is warned of; no districts when nothing", viewSchema) },
    }),
    async (c) => c.json(await warningsOf(c.env, c.req.valid("json").endpoint), 200),
  );

  addRoute(
    api,
    "public",
    createRoute({
      method: "put",
      path: "/warnings",
      request: { body: jsonBody(choiceBody) },
      responses: {
        200: jsonResponse("Kept: what this phone is now warned of", viewSchema),
        400: refusal("Not a push service, no districts or more than three, or a district not known"),
        429: refusal("Too many changes from this address"),
        503: refusal("Warnings are shut, or full"),
      },
    }),
    async (c) => {
      const { endpoint, keys, districts, hazards, threshold } = c.req.valid("json");
      const answer = await chooseWarnings(c.env, c.var.address, {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        districts,
        hazards,
        threshold,
      });
      if (answer.kind === "limit") return limitRefused(c, answer.refusal, null);
      if (answer.kind === "unknownDistrict") return refuse(c, 400, "request.refused");
      if (answer.kind === "closed") return refuse(c, 503, "warnings.closed");
      if (answer.kind === "full") return refuse(c, 503, "warnings.full");
      return c.json(answer.view, 200);
    },
  );

  addRoute(
    api,
    "public",
    createRoute({
      method: "post",
      path: "/warnings/stop",
      request: { body: jsonBody(phone) },
      responses: {
        204: { description: "This phone is warned of nothing" },
        429: refusal("Too many changes from this address"),
      },
    }),
    async (c) => {
      const refusal = await stopChoice(c.env, c.var.address, c.req.valid("json").endpoint);
      return refusal ? limitRefused(c, refusal, null) : c.body(null, 204);
    },
  );
}
