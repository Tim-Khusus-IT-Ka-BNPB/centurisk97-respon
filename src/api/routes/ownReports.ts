import { createRoute, z } from "@hono/zod-openapi";
import { ownReportDetailSchema } from "../../contract/ownReport";
import { DOCUMENT_FORMATS } from "../../domain/document";
import { ownDocument } from "../../services/documents";
import { readOwnReport } from "../../services/ownReport";
import { ownProof } from "../../services/tracking";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonResponse, refusal } from "../route";
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
