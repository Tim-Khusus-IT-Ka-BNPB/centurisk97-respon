import { createRoute, z } from "@hono/zod-openapi";
import { oneTapSentSchema, oneTapStartSchema } from "../../contract/emergency";
import { VICTIM_ANSWERS } from "../../domain/emergency";
import { type HazardTypeId, SELECTABLE_HAZARD_TYPES } from "../../domain/hazards";
import { OFFLINE_PHOTOS } from "../../domain/offline";
import { addOfflinePhoto, oneTapEmergency, oneTapStart, type Reporter } from "../../services/emergency";
import type { ApiContext } from "../context";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { deviceFix, fieldErrors, isSet, limitRefused, optionalBox, photoForm } from "./shared";

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
            // A report made with no signal: what it told, when it was made, and its id from the phone.
            hazardType: z.enum(SELECTABLE_HAZARD_TYPES as [HazardTypeId, ...HazardTypeId[]]).optional(),
            victims: z.enum(VICTIM_ANSWERS).optional(),
            takenAtMs: z.number().int().nonnegative().optional(),
            sentAtMs: z.number().int().nonnegative().optional(),
            clientId: z.uuid().optional(),
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

  addRoute(
    api,
    "reporter",
    createRoute({
      method: "post",
      path: "/emergencies/{clientId}/photos",
      request: {
        params: z.object({ clientId: z.uuid() }),
        body: {
          content: {
            "multipart/form-data": {
              schema: photoForm.extend({
                index: z.coerce
                  .number()
                  .int()
                  .min(0)
                  .max(OFFLINE_PHOTOS - 1),
                offset: optionalBox(z.coerce.number().int().min(-840).max(840)),
              }),
            },
          },
          required: true,
        },
      },
      responses: {
        201: jsonResponse(
          "The photo is with the report it was kept with",
          z.object({ photos: z.number().int().nonnegative() }),
        ),
        404: refusal("No report sent from this phone under this id"),
        422: refusal("The photo is refused, on field photo; the report stays as it is"),
        429: refusal("Too many from this address"),
      },
    }),
    async (c) => {
      const form = c.req.valid("form");
      const answer = await addOfflinePhoto(c.env, reporterOf(c), c.var.address, c.req.valid("param").clientId, {
        index: form.index,
        bytes: new Uint8Array(await form.photo.arrayBuffer()),
        device: deviceFix(form),
        offsetMinutes: isSet(form.offset) ? form.offset : null,
      });
      if (answer.kind === "notFound") return refuse(c, 404, "report.notFound");
      if (answer.kind === "limit") return limitRefused(c, answer.refusal, null);
      if (answer.kind === "refused")
        return refuse(c, 422, "request.invalidFields", {
          fields: fieldErrors([{ fieldId: "photo", rule: `photo.${answer.rule}`, params: {} }]),
        });
      return c.json({ photos: answer.photos }, 201);
    },
  );
}
