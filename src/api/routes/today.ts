import { createRoute, z } from "@hono/zod-openapi";
import { deskReportSchema } from "../../contract/desk";
import { todaySchema } from "../../contract/today";
import { SELECTABLE_HAZARD_TYPES } from "../../domain/hazards";
import { todayView } from "../../services/today";
import { setTodayPull } from "../../services/todayDesk";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { changeAnswered, staffOf, ticketParams } from "./desk";
import { limitRefused } from "./shared";

// The public today page (upstream lapor-kejadian, row 36), and the desk pulling an event off it.
export function addTodayRoutes(api: Api): void {
  addRoute(
    api,
    "public",
    createRoute({
      method: "get",
      path: "/today",
      request: {
        query: z.strictObject({
          province: z
            .string()
            .regex(/^\d{2}$/)
            .optional(),
          hazard: z.enum(SELECTABLE_HAZARD_TYPES as [string, ...string[]]).optional(),
        }),
      },
      responses: {
        200: jsonResponse("Events verified by their region's BPBD in the last 24 hours", todaySchema),
        400: refusal("An unknown filter"),
        404: refusal("The today page is not open"),
        429: refusal("Too many opens from this address"),
      },
    }),
    async (c) => {
      const { province, hazard } = c.req.valid("query");
      const answer = await todayView(c.env, c.var.address, {
        provinceCode: province ?? null,
        hazardType: hazard ?? null,
      });
      if (answer.kind === "closed") return refuse(c, 404, "today.closed");
      if (answer.kind === "limit") return limitRefused(c, answer.refusal, null);
      return c.json(answer.today, 200);
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/reports/{ticketNumber}/today",
      request: { params: ticketParams, body: jsonBody(z.object({ pulled: z.boolean() })) },
      responses: {
        200: jsonResponse("Pulled off the today page, or put back, with the report as it is now", deskReportSchema),
        404: refusal("No such report in this account's region, or the page is shut"),
      },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      const { ticketNumber } = c.req.valid("param");
      return changeAnswered(c, await setTodayPull(c.env, staffOf(c), ticketNumber, c.req.valid("json").pulled));
    },
  );
}
