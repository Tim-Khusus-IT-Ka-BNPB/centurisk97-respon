import { createRoute, z } from "@hono/zod-openapi";
import { followUpSchema, ownReportDetailSchema } from "../../contract/ownReport";
import { DOCUMENT_FORMATS } from "../../domain/document";
import { ownDocument } from "../../services/documents";
import { startFollowUp } from "../../services/followUp";
import { actOnNews, readOwnReport } from "../../services/ownReport";
import { ownProof } from "../../services/tracking";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { documentFile, documentSent, jpegFile, jpegSent, limitRefused } from "./shared";

const params = z.object({ ticketNumber: z.string().max(20) });

export function addOwnReportRoutes(api: Api): void {
  addRoute(
    api,
    "reporter",
    createRoute({
      method: "get",
      path: "/reports/{ticketNumber}",
      request: { params },
      responses: {
        200: jsonResponse("The report, to the phone or session that sent it", ownReportDetailSchema),
        429: refusal("Too many opens from this address"),
      },
    }),
    async (c) => {
      const answer = await readOwnReport(c.env, c.var.principal, c.var.address, c.req.valid("param").ticketNumber);
      if (answer.kind === "limit") return limitRefused(c, answer.refusal, null);
      if (answer.kind === "notFound") return refuse(c, 404, "report.notFound");
      c.header("x-robots-tag", "noindex");
      return c.json(answer.body, 200);
    },
  );

  addRoute(
    api,
    "reporter",
    createRoute({
      method: "post",
      path: "/reports/{ticketNumber}/follow-ups",
      request: { params },
      responses: {
        201: jsonResponse("A draft of news for this report, new or the one already open", followUpSchema),
        409: refusal("News is no longer taken, or a report being written must be finished first"),
        429: refusal("Too many from this number"),
      },
    }),
    async (c) => {
      const answer = await startFollowUp(c.env, c.var.principal, c.req.valid("param").ticketNumber);
      switch (answer.kind) {
        case "draft":
          return c.json({ draftId: answer.draftId }, 201);
        case "notFound":
          return refuse(c, 404, "report.notFound");
        case "limit":
          return limitRefused(c, answer.refusal, null);
        case "openExists":
          return refuse(c, 409, "followUp.finishFirst", { params: { draftId: answer.draftId } });
        default:
          return refuse(c, 409, "followUp.closed", { params: { reason: `followUp.closed.${answer.reason}` } });
      }
    },
  );

  addRoute(
    api,
    "reporter",
    createRoute({
      method: "post",
      path: "/reports/{ticketNumber}/news",
      request: { params, body: jsonBody(z.object({ act: z.enum(["read", "stop", "start"]) })) },
      responses: {
        204: { description: "The news is read up to now, stopped, or wanted again" },
        429: refusal("Too many from this number"),
      },
    }),
    async (c) => {
      const { ticketNumber } = c.req.valid("param");
      const answer = await actOnNews(c.env, c.var.principal, ticketNumber, c.req.valid("json").act);
      if (answer.kind === "limit") return limitRefused(c, answer.refusal, null);
      return answer.kind === "notFound" ? refuse(c, 404, "report.notFound") : c.body(null, 204);
    },
  );

  // Public for the same reason as the documents below.
  addRoute(
    api,
    "public",
    createRoute({
      method: "get",
      path: "/reports/{ticketNumber}/proofs/{proofId}",
      request: { params: params.extend({ proofId: z.uuid() }) },
      responses: {
        200: jpegFile("A photo of the work on this closed report"),
        404: refusal("No such photo for this reporter"),
      },
    }),
    async (c) => {
      const { ticketNumber, proofId } = c.req.valid("param");
      const bytes = await ownProof(c.env, c.var.principal, ticketNumber, proofId);
      return bytes === null ? refuse(c, 404, "report.notFound") : jpegSent(c, bytes);
    },
  );

  // Public, so a document that is not the caller's answers 404 whoever asks, signed out included;
  // the service checks the owner.
  addRoute(
    api,
    "public",
    createRoute({
      method: "get",
      path: "/reports/{ticketNumber}/documents/{version}/{format}",
      request: {
        params: params.extend({
          version: z.coerce.number().int().positive(),
          format: z.enum(DOCUMENT_FORMATS),
        }),
      },
      responses: {
        200: documentFile("The report at this version, as a file"),
        404: refusal("No such document for this reporter"),
        429: refusal("Too many downloads from this number"),
      },
    }),
    async (c) => {
      const { ticketNumber, version, format } = c.req.valid("param");
      const answer = await ownDocument(c.env, c.var.principal, ticketNumber, version, format);
      if (answer.kind === "file") return documentSent(c, answer);
      return answer.kind === "limit" ? limitRefused(c, answer.refusal, null) : refuse(c, 404, "report.notFound");
    },
  );
}
