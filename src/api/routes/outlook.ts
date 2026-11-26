import { createRoute, z } from "@hono/zod-openapi";
import { outlookSchema } from "../../contract/outlook";
import { outlookFor } from "../../services/outlook";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonResponse, refusal } from "../route";

const outlookQuery = z.strictObject({ regency: z.string().regex(/^\d{2}\.\d{2}$/) });

export function addOutlookRoutes(api: Api): void {
  addRoute(
    api,
    "public",
    createRoute({
      method: "get",
      path: "/outlook",
      request: { query: outlookQuery },
      responses: {
        200: jsonResponse("A regency's three days and its BPBD to call", outlookSchema),
        400: refusal("No regency, or not a regency's code"),
        404: refusal("The outlook has no such regency"),
        503: refusal("No outlook can be read"),
      },
    }),
    async (c) => {
      const answer = await outlookFor(c.env, c.req.valid("query").regency);
      if (answer.kind === "unavailable") return refuse(c, 503, "request.unavailable");
      if (answer.kind === "notFound") return refuse(c, 404, "outlook.regencyNotFound");
      return c.json(answer.outlook, 200);
    },
  );
}
