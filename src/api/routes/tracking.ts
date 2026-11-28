import { createRoute, z } from "@hono/zod-openapi";
import { referenceFile } from "../../adapters/postgres/reports";
import { trackedSchema } from "../../contract/tracking";
import { checkEducationFile, TOPIC_LISTS } from "../../domain/education";
import { rateOwnReport, trackedProof, trackReport } from "../../services/tracking";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { fieldErrors, jpegFile, limitRefused } from "./shared";

// The token travels in the body: the page reads it from the link's fragment, so it never sits in
// an address a log or a referrer could keep.
const trackBody = z.object({ token: z.string().max(64) });

const rateParams = z.object({ ticketNumber: z.string().max(20) });
// Any number, so a refused value is answered with the allowed range, not as a malformed body.
const rateBody = z.object({ rating: z.number() });

const educationSchema = z.object({
  dataDate: z.string(),
  topics: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
      lists: z.array(z.object({ kind: z.enum(TOPIC_LISTS), items: z.array(z.string()) })),
      sources: z.array(z.object({ organisation: z.string(), title: z.string(), url: z.url() })),
    }),
  ),
});

export function addTrackingRoutes(api: Api): void {
  // The preparedness topics for help (K28), with their sources. Content, not copy: it comes from
  // the imported file and may change with it.
  addRoute(
    api,
    "public",
    createRoute({
      method: "get",
      path: "/education",
      responses: {
        200: jsonResponse("The preparedness topics and their data date", educationSchema),
        503: refusal("No topics are loaded"),
      },
    }),
    async (c) => {
      const file = checkEducationFile(await referenceFile(c.env.db, "education"));
      if (file === null) return refuse(c, 503, "request.unavailable");
      return c.json(
        {
          dataDate: file.dibuat,
          topics: file.topik.map((topic) => ({
            id: topic.id,
            title: topic.judul,
            summary: topic.ringkas,
            lists: TOPIC_LISTS.flatMap((kind) => {
              const items = topic[kind];
              return items ? [{ kind, items: [...items] }] : [];
            }),
            sources: topic.sumber.map((source) => ({
              organisation: source.lembaga,
              title: source.judul,
              url: source.url,
            })),
          })),
        },
        200,
      );
    },
  );

  addRoute(
    api,
    "public",
    createRoute({
      method: "post",
      path: "/tracking",
      request: { body: jsonBody(trackBody) },
      responses: {
        200: jsonResponse("The report as anyone with its link sees it, with staff's replies", trackedSchema),
        404: refusal("No report has this link"),
        429: refusal("Too many opens from this address"),
      },
    }),
    async (c) => {
      const answer = await trackReport(c.env, c.var.address, c.req.valid("json").token);
      if (answer.kind === "limit") return limitRefused(c, answer.refusal, null);
      if (answer.kind === "notFound") return refuse(c, 404, "tracking.notFound");
      c.header("x-robots-tag", "noindex");
      return c.json(answer.tracking, 200);
    },
  );

  // The token travels in the body here too, so a photo has no address of its own to share.
  addRoute(
    api,
    "public",
    createRoute({
      method: "post",
      path: "/tracking/photos",
      request: { body: jsonBody(trackBody.extend({ proofId: z.uuid() })) },
      responses: {
        200: jpegFile("A photo of the work on this closed report"),
        404: refusal("No such photo for this link"),
        429: refusal("Too many opens from this address"),
      },
    }),
    async (c) => {
      const { token, proofId } = c.req.valid("json");
      const answer = await trackedProof(c.env, c.var.address, token, proofId);
      if (answer.kind === "limit") return limitRefused(c, answer.refusal, null);
      if (answer.kind === "notFound") return refuse(c, 404, "tracking.notFound");
      return c.body(new Uint8Array(answer.bytes), 200, {
        "content-type": "image/jpeg",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex",
        "cache-control": "private, no-store",
      });
    },
  );

  addRoute(
    api,
    "reporter",
    createRoute({
      method: "post",
      path: "/reports/{ticketNumber}/rating",
      request: { params: rateParams, body: jsonBody(rateBody) },
      responses: {
        204: { description: "Stored; a new rating replaces the old one" },
        422: refusal("Not a whole number from 1 to 5, on field rating"),
        429: refusal("Too many ratings from this number"),
      },
    }),
    async (c) => {
      const answer = await rateOwnReport(
        c.env,
        c.var.principal,
        c.req.valid("param").ticketNumber,
        c.req.valid("json").rating,
      );
      if (answer.kind === "limit") return limitRefused(c, answer.refusal, null);
      if (answer.kind === "notFound") return refuse(c, 404, "report.notFound");
      if (answer.kind === "invalid")
        return refuse(c, 422, "request.invalidFields", { fields: fieldErrors(answer.errors) });
      return c.body(null, 204);
    },
  );
}
