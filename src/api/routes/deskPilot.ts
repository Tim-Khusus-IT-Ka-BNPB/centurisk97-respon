import { createRoute, z } from "@hono/zod-openapi";
import { deskPilotSchema } from "../../contract/desk";
import type { StaffPrincipal } from "../../ports/identity";
import { allowOnDesk, deskPilot, removeOnDesk } from "../../services/pilot";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { answered } from "./desk";
import { fieldErrors } from "./shared";

// Any length a person could type, so a text too long is answered on its field.
const typed = z.string().max(400);

// Which numbers the WhatsApp pilot serves, for BNPB's desk officers.
export function addDeskPilotRoutes(api: Api): void {
  addRoute(
    api,
    "staff",
    createRoute({
      method: "get",
      path: "/desk/pilot",
      responses: { 200: jsonResponse("The numbers allowed, the newest first", deskPilotSchema) },
    }),
    async (c) => answered(c, await deskPilot(c.env, c.var.principal as StaffPrincipal)),
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/pilot",
      request: { body: jsonBody(z.object({ number: typed, officerRegency: typed.default("") })) },
      responses: {
        200: jsonResponse("Allowed and logged; the list as it is now", deskPilotSchema),
        422: refusal("The number or the BPBD is refused, on its field"),
      },
    }),
    async (c) => {
      const change = await allowOnDesk(c.env, c.var.principal as StaffPrincipal, c.req.valid("json"));
      if (change.kind === "invalid")
        return refuse(c, 422, "request.invalidFields", { fields: fieldErrors(change.errors) });
      return answered(c, change);
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "delete",
      path: "/desk/pilot/{key}",
      request: {
        params: z.object({ key: z.string().regex(/^[0-9a-f]{64}$/) }),
        body: jsonBody(z.object({ confirm: z.literal(true) })),
      },
      responses: { 200: jsonResponse("Taken away and logged; the list as it is now", deskPilotSchema) },
    }),
    async (c) => answered(c, await removeOnDesk(c.env, c.var.principal as StaffPrincipal, c.req.valid("param").key)),
  );
}
