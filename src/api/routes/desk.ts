import { createRoute, z } from "@hono/zod-openapi";
import { deleteCookie, setCookie } from "hono/cookie";
import { isSeededStaffCode, SESSION_COOKIE } from "../../adapters/identity/seeded";
import { hazardTypeSchema } from "../../contract/common";
import { deskQueueSchema, deskReportSchema } from "../../contract/desk";
import { ticketStatusSchema } from "../../contract/tracking";
import { DESK_PERIODS } from "../../domain/deskQueue";
import { isTicketNumber } from "../../domain/ticketNumber";
import type { StaffPrincipal } from "../../ports/identity";
import { type DeskAnswer, deskQueue, readDeskReport, viewDeskReport } from "../../services/desk";
import { checkLimits } from "../../services/limits";
import type { ApiContext } from "../context";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { fieldErrors, limitRefused } from "./shared";

const queueQuery = z.object({
  status: ticketStatusSchema.optional(),
  hazardType: hazardTypeSchema.optional(),
  period: z.enum(DESK_PERIODS).default("all"),
  // Any text, so a wrong number is answered on its field, not as a malformed request.
  ticket: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

const ticketParams = z.object({ ticketNumber: z.string().max(20) });

function answered<T>(c: ApiContext, answer: DeskAnswer<T>): Response {
  if (answer.kind === "ok") return c.json(answer.body as object, 200);
  if (answer.kind === "notAllowed") return refuse(c, 403, "desk.notAllowed");
  if (answer.kind === "notFound") return refuse(c, 404, "desk.reportNotFound");
  return limitRefused(c, answer.refusal, null);
}

const staffOf = (c: ApiContext) => c.var.principal as StaffPrincipal;

export function addDeskRoutes(api: Api): void {
  addRoute(
    api,
    "staff",
    createRoute({
      method: "get",
      path: "/desk/reports",
      request: { query: queueQuery },
      responses: {
        200: jsonResponse("One page of sent reports, newest first", deskQueueSchema),
        422: refusal("The ticket number searched is not one, on field ticket"),
      },
    }),
    async (c) => {
      const query = c.req.valid("query");
      const ticket = query.ticket?.trim().toUpperCase() ?? "";
      if (ticket !== "" && !isTicketNumber(ticket))
        return refuse(c, 422, "request.invalidFields", {
          fields: fieldErrors([{ fieldId: "ticket", rule: "ticketNumber.format", params: {} }]),
        });
      const answer = await deskQueue(c.env, staffOf(c), {
        status: query.status ?? null,
        hazardType: query.hazardType ?? null,
        period: query.period,
        ticketNumber: ticket === "" ? null : ticket,
        page: query.page,
      });
      c.header("x-robots-tag", "noindex");
      return answered(c, answer);
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "get",
      path: "/desk/reports/{ticketNumber}",
      request: { params: ticketParams },
      responses: { 200: jsonResponse("The report with every value and where it came from", deskReportSchema) },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      return answered(c, await readDeskReport(c.env, staffOf(c), c.req.valid("param").ticketNumber));
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/reports/{ticketNumber}/view",
      request: { params: ticketParams },
      responses: { 200: jsonResponse("Logged; a new ticket is now seen", deskReportSchema) },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      return answered(c, await viewDeskReport(c.env, staffOf(c), c.req.valid("param").ticketNumber));
    },
  );

  // Local, test and staging stand in for the main site's staff sign-in with seeded codes. The
  // upstream adapter has its own sign-in, so in production this route does not exist.
  addRoute(
    api,
    "public",
    createRoute({
      method: "post",
      path: "/desk/session",
      request: { body: jsonBody(z.object({ code: z.string().max(200) })) },
      responses: {
        204: { description: "Signed in; the session cookie is set" },
        404: refusal("No seeded sign-in here"),
        422: refusal("The code is not a staff code, on field code"),
        429: refusal("Too many sign-ins from this address"),
      },
    }),
    async (c) => {
      if (c.env.settings.identityAdapter !== "seeded") return refuse(c, 404, "request.refused");
      const refusal = await checkLimits(c.env, [["address.staffSignIn", { kind: "address", bucket: c.var.address }]]);
      if (refusal) return limitRefused(c, refusal, null);
      const code = c.req.valid("json").code.trim();
      if (!(await isSeededStaffCode(c.env.db, code)))
        return refuse(c, 422, "request.invalidFields", {
          fields: fieldErrors([{ fieldId: "code", rule: "staffCode.unknown", params: {} }]),
        });
      setCookie(c, SESSION_COOKIE, code, {
        httpOnly: true,
        secure: new URL(c.req.url).protocol === "https:",
        sameSite: "Lax",
        path: "/",
      });
      return c.body(null, 204);
    },
  );

  addRoute(
    api,
    "public",
    createRoute({
      method: "delete",
      path: "/desk/session",
      responses: { 204: { description: "Signed out" } },
    }),
    (c) => {
      deleteCookie(c, SESSION_COOKIE, { path: "/", secure: new URL(c.req.url).protocol === "https:" });
      return c.body(null, 204);
    },
  );
}
