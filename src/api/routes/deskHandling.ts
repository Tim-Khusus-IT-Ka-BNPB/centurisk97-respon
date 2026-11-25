import { createRoute, z } from "@hono/zod-openapi";
import { deskReportSchema, deskResponseSchema } from "../../contract/desk";
import { CHECK_RESULTS } from "../../domain/fieldCheck";
import { monthOf } from "../../domain/response";
import { addHandling, addHandlingProof, checkInField, deskProofFile } from "../../services/handling";
import { deskResponse, takeDeskReport } from "../../services/taker";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { answered, changeAnswered, staffOf, staffText, ticketParams } from "./desk";
import { deviceFix, jpegFile, photoForm } from "./shared";

export function addDeskHandlingRoutes(api: Api): void {
  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/reports/{ticketNumber}/checks",
      request: {
        params: ticketParams,
        body: jsonBody(
          z.object({
            result: z.enum(CHECK_RESULTS),
            note: staffText.default(""),
            // The figure boxes as typed, by field; one left empty or as it was changes nothing.
            boxes: z.record(z.string().max(40), z.string().max(40)).default({}),
            revision: z.number().int().nonnegative(),
          }),
        ),
      },
      responses: {
        200: jsonResponse("Kept, with the version a correction made", deskReportSchema),
        409: refusal("The report is closed or set aside, or another officer changed the ticket first"),
        422: refusal("A figure, the result or the note is refused, on its field"),
      },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      const { ticketNumber } = c.req.valid("param");
      return changeAnswered(c, await checkInField(c.env, staffOf(c), ticketNumber, c.req.valid("json")));
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/reports/{ticketNumber}/actions",
      request: {
        params: ticketParams,
        body: jsonBody(
          z.object({ actions: z.array(z.string().max(60)).max(60).default([]), otherAction: staffText.default("") }),
        ),
      },
      responses: {
        200: jsonResponse("Kept with the report", deskReportSchema),
        409: refusal("The report is not being handled"),
        422: refusal("No action, an unknown one, or other words too short or long, on its field"),
      },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      const { ticketNumber } = c.req.valid("param");
      return changeAnswered(c, await addHandling(c.env, staffOf(c), ticketNumber, c.req.valid("json")));
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/reports/{ticketNumber}/proofs",
      request: {
        params: ticketParams,
        body: { content: { "multipart/form-data": { schema: photoForm } }, required: true },
      },
      responses: {
        200: jsonResponse("Kept, metadata stripped", deskReportSchema),
        409: refusal("The report is not being handled"),
        422: refusal("The photo is refused, on field proof"),
      },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      const form = c.req.valid("form");
      const bytes = new Uint8Array(await form.photo.arrayBuffer());
      const { ticketNumber } = c.req.valid("param");
      return changeAnswered(
        c,
        await addHandlingProof(c.env, staffOf(c), ticketNumber, { bytes, device: deviceFix(form) }),
      );
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/reports/{ticketNumber}/take",
      request: { params: ticketParams },
      responses: {
        200: jsonResponse("In this officer's hand", deskReportSchema),
        409: refusal("Another officer has it, or it is closed or set aside"),
      },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      return changeAnswered(c, await takeDeskReport(c.env, staffOf(c), c.req.valid("param").ticketNumber));
    },
  );

  // The figures the leaders' page will call (upstream's respons).
  addRoute(
    api,
    "staff",
    createRoute({
      method: "get",
      path: "/desk/response",
      request: { query: z.object({ month: z.string().max(20).optional() }) },
      responses: {
        200: jsonResponse("How fast each agency answered the month's reports", deskResponseSchema),
        400: refusal("The month is not written YYYY-MM"),
      },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      const month = c.req.valid("query").month ?? monthOf(c.env.clock.now());
      const answer = await deskResponse(c.env, staffOf(c), month);
      return answer.kind === "badMonth" ? refuse(c, 400, "request.refused") : answered(c, answer);
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "get",
      path: "/desk/proofs/{proofId}",
      request: { params: z.object({ proofId: z.uuid() }) },
      responses: { 200: jpegFile("A photo of the work, metadata stripped") },
    }),
    async (c) => {
      const file = await deskProofFile(c.env, staffOf(c), c.req.valid("param").proofId);
      if (file.kind !== "file") return answered(c, file);
      return c.body(new Uint8Array(file.bytes), 200, {
        "content-type": "image/jpeg",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex",
      });
    },
  );
}
