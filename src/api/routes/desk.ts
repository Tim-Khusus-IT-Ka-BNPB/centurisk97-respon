import { createRoute, z } from "@hono/zod-openapi";
import { deleteCookie, setCookie } from "hono/cookie";
import { isSeededStaffCode, SESSION_COOKIE } from "../../adapters/identity/seeded";
import { hazardTypeSchema } from "../../contract/common";
import {
  deskGallerySchema,
  deskIdentitySchema,
  deskMapSchema,
  deskQueueSchema,
  deskReportSchema,
  deskSummarySchema,
} from "../../contract/desk";
import { ticketStatusSchema } from "../../contract/tracking";
import { DESK_HAS, DESK_PERIODS } from "../../domain/deskQueue";
import { isTicketNumber } from "../../domain/ticketNumber";
import type { StaffPrincipal } from "../../ports/identity";
import {
  type DeskAnswer,
  type DeskChange,
  deskGallery,
  deskMap,
  deskPhotoFile,
  deskQueue,
  deskSummary,
  moveDeskTicket,
  readDeskReport,
  replyToReporter,
  revealIdentity,
  viewDeskReport,
} from "../../services/desk";
import { checkLimits } from "../../services/limits";
import type { ApiContext } from "../context";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { fieldErrors, jpegFile, limitRefused } from "./shared";

const queueQuery = z.object({
  status: ticketStatusSchema.optional(),
  hazardType: hazardTypeSchema.optional(),
  period: z.enum(DESK_PERIODS).default("all"),
  // Any text, so a wrong number is answered on its field, not as a malformed request.
  ticket: z.string().max(40).optional(),
  has: z.enum(DESK_HAS).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

// Any length a person could type, so a text too long is answered on its field.
export const staffText = z.string().max(20_000);

export const ticketParams = z.object({ ticketNumber: z.string().max(20) });

// The map and the gallery share the queue's filters, with no paging.
const filterQuery = queueQuery.omit({ page: true });

const ticketRefused = (c: ApiContext) =>
  refuse(c, 422, "request.invalidFields", {
    fields: fieldErrors([{ fieldId: "ticket", rule: "ticketNumber.format", params: {} }]),
  });

// The searched ticket number in capitals, null for none, or "invalid" for text that is not one.
function searchedTicket(text: string | undefined): string | null | "invalid" {
  const ticket = text?.trim().toUpperCase() ?? "";
  if (ticket === "") return null;
  return isTicketNumber(ticket) ? ticket : "invalid";
}

export function answered<T>(c: ApiContext, answer: DeskAnswer<T>): Response {
  if (answer.kind === "ok") return c.json(answer.body as object, 200);
  if (answer.kind === "notAllowed") return refuse(c, 403, "desk.notAllowed");
  if (answer.kind === "notFound") return refuse(c, 404, "desk.reportNotFound");
  return limitRefused(c, answer.refusal, null);
}

// A change to a ticket: refused on a field, as a move not offered, or because another was first.
export function changeAnswered(c: ApiContext, change: DeskChange): Response {
  if (change.kind === "invalid")
    return refuse(c, 422, "request.invalidFields", { fields: fieldErrors([change.error]) });
  if (change.kind === "transitionRefused") return refuse(c, 409, "ticket.transitionRefused");
  if (change.kind === "changed")
    return refuse(c, 409, "ticket.changed", { params: { status: `stage.short.${change.status}` } });
  return answered(c, change);
}

export const staffOf = (c: ApiContext) => c.var.principal as StaffPrincipal;

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
      const ticketNumber = searchedTicket(query.ticket);
      if (ticketNumber === "invalid") return ticketRefused(c);
      const answer = await deskQueue(c.env, staffOf(c), {
        status: query.status ?? null,
        hazardType: query.hazardType ?? null,
        period: query.period,
        ticketNumber,
        has: query.has ?? null,
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

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/reports/{ticketNumber}/identity",
      request: { params: ticketParams },
      responses: { 200: jsonResponse("Logged; who reported", deskIdentitySchema) },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      c.header("cache-control", "no-store");
      return answered(c, await revealIdentity(c.env, staffOf(c), c.req.valid("param").ticketNumber));
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/reports/{ticketNumber}/status",
      request: {
        params: ticketParams,
        body: jsonBody(
          z.object({
            to: ticketStatusSchema,
            note: staffText.default(""),
            revision: z.number().int().nonnegative(),
            actions: z.array(z.string().max(60)).max(60).default([]),
            otherAction: staffText.default(""),
          }),
        ),
      },
      responses: {
        200: jsonResponse("Moved, with its history row", deskReportSchema),
        409: refusal("Not a move from here, or another officer changed the ticket first"),
        422: refusal("The note or the actions are missing or too long, on fields note, actions or otherAction"),
      },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      const { ticketNumber } = c.req.valid("param");
      return changeAnswered(c, await moveDeskTicket(c.env, staffOf(c), ticketNumber, c.req.valid("json")));
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/reports/{ticketNumber}/replies",
      request: { params: ticketParams, body: jsonBody(z.object({ text: staffText })) },
      responses: {
        200: jsonResponse("Kept; a ticket not yet under review now is", deskReportSchema),
        422: refusal("The reply is empty or too long, on field reply"),
      },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      const { ticketNumber } = c.req.valid("param");
      return changeAnswered(c, await replyToReporter(c.env, staffOf(c), ticketNumber, c.req.valid("json").text));
    },
  );

  for (const [path, schema, read, description] of [
    ["/desk/map", deskMapSchema, deskMap, "The filtered reports as points, newest first"],
    ["/desk/photos", deskGallerySchema, deskGallery, "Photos of the filtered reports, newest first"],
    ["/desk/summary", deskSummarySchema, deskSummary, "Counts per status queue, hazard chip and holding"],
  ] as const)
    addRoute(
      api,
      "staff",
      createRoute({
        method: "get",
        path,
        request: { query: filterQuery },
        responses: {
          200: jsonResponse(description, schema),
          422: refusal("The ticket number searched is not one, on field ticket"),
        },
      }),
      async (c) => {
        const query = c.req.valid("query");
        const ticketNumber = searchedTicket(query.ticket);
        if (ticketNumber === "invalid") return ticketRefused(c);
        c.header("x-robots-tag", "noindex");
        return answered<object>(
          c,
          await read(c.env, staffOf(c), {
            status: query.status ?? null,
            hazardType: query.hazardType ?? null,
            period: query.period,
            ticketNumber,
            has: query.has ?? null,
          }),
        );
      },
    );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "get",
      path: "/desk/photos/{photoId}",
      request: { params: z.object({ photoId: z.uuid() }) },
      responses: {
        200: jpegFile("A sent report's photo, metadata stripped"),
      },
    }),
    async (c) => {
      const file = await deskPhotoFile(c.env, staffOf(c), c.req.valid("param").photoId);
      if (file.kind !== "file") return answered(c, file);
      return c.body(new Uint8Array(file.bytes), 200, {
        "content-type": "image/jpeg",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex",
      });
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
