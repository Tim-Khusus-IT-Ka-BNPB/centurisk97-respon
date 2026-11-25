import { createRoute, z } from "@hono/zod-openapi";
import { oneTapSentSchema, oneTapStartSchema } from "../../contract/emergency";
import { oneTapEmergency, oneTapStart, type Reporter } from "../../services/emergency";
import type { ApiContext } from "../context";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { fieldErrors, limitRefused } from "./shared";

// The policy lets only a reporter's phone or session this far.
const reporterOf = (c: ApiContext) => c.var.principal as Reporter;

export function addEmergencyRoutes(api: Api): void {
  addRoute(
    api,
    "reporter",
    createRoute({
      method: "get",
      path: "/emergencies/start",
      responses: {
        200: jsonResponse("Who a one-tap emergency goes under, and who to call now", oneTapStartSchema),
        404: refusal("Nobody has reported from here yet"),
      },
    }),
    async (c) => {
      const start = await oneTapStart(c.env, reporterOf(c));
      return start === null ? refuse(c, 404, "draft.notFound") : c.json(start, 200);
    },
  );

  addRoute(
    api,
    "reporter",
    createRoute({
      method: "post",
      path: "/emergencies",
      request: {
        body: jsonBody(
          z.object({
            lat: z.number().min(-90).max(90),
            lon: z.number().min(-180).max(180),
            accuracyM: z.number().min(0).max(1e7),
          }),
        ),
      },
      responses: {
        201: jsonResponse("The point is with the desk", oneTapSentSchema),
        404: refusal("Nobody has reported from here yet"),
        422: refusal("The point is not in a village of Indonesia, on field place"),
        429: refusal("A tap too soon, with when the next may come"),
      },
    }),
    async (c) => {
      const answer = await oneTapEmergency(c.env, reporterOf(c), c.var.address, c.req.valid("json"));
      if (answer.kind === "unknownReporter") return refuse(c, 404, "draft.notFound");
      if (answer.kind === "limit") return limitRefused(c, answer.refusal, null);
      if (answer.kind === "place")
        return refuse(c, 422, "request.invalidFields", {
          fields: fieldErrors([{ fieldId: "place", rule: `emergency.${answer.rule}`, params: {} }]),
        });
      const { ticketNumber, trackingToken, contact } = answer;
      return c.json({ ticketNumber, trackingToken, contact }, 201);
    },
  );
}
