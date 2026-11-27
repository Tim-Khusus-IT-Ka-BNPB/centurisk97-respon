import { createRoute, z } from "@hono/zod-openapi";
import { deskReportSchema } from "../../contract/desk";
import { feedSchema, watchSchema } from "../../contract/publicFeed";
import { FEED_PERIODS } from "../../domain/feedPeriod";
import { SELECTABLE_HAZARD_TYPES } from "../../domain/hazards";
import { releaseReport } from "../../services/events";
import { feedProof, markProofPublic, publicFeed, watchView } from "../../services/publicFeed";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { changeAnswered, staffOf, ticketParams } from "./desk";
import { jpegFile, limitRefused } from "./shared";

// Only known filters: any other query is refused, so no other value reaches the feed's reads.
const feedQuery = z.strictObject({
  hazard: z.enum(SELECTABLE_HAZARD_TYPES as [string, ...string[]]).optional(),
  province: z
    .string()
    .regex(/^\d{2}$/)
    .optional(),
  period: z.enum(FEED_PERIODS).optional(),
});

export function addPublicFeedRoutes(api: Api): void {
  addRoute(
    api,
    "public",
    createRoute({
      method: "get",
      path: "/feed",
      request: { query: feedQuery },
      responses: {
        200: jsonResponse("Reports being handled or closed, one entry per event, with no reporter data", feedSchema),
        400: refusal("An unknown filter"),
        429: refusal("Too many opens from this address"),
      },
    }),
    async (c) => {
      const { hazard, province, period } = c.req.valid("query");
      const answer = await publicFeed(c.env, c.var.address, {
        hazardType: hazard ?? null,
        provinceCode: province ?? null,
        period: period ?? "all",
      });
      if (answer.kind === "limit") return limitRefused(c, answer.refusal, null);
      return c.json(answer.feed, 200);
    },
  );

  addRoute(
    api,
    "public",
    createRoute({
      method: "get",
      path: "/feed/watch",
      responses: {
        200: jsonResponse(
          "Regencies the outlook puts at Waspada or above, and volcanoes at Siaga or Awas",
          watchSchema,
        ),
        429: refusal("Too many opens from this address"),
      },
    }),
    async (c) => {
      const answer = await watchView(c.env, c.var.address);
      if (answer.kind === "limit") return limitRefused(c, answer.refusal, null);
      return c.json(answer.watch, 200);
    },
  );

  addRoute(
    api,
    "public",
    createRoute({
      method: "get",
      path: "/feed/proofs/{proofId}",
      request: { params: z.object({ proofId: z.uuid() }) },
      responses: {
        200: jpegFile("A photo of the work an officer marked public"),
        404: refusal("No such public photo"),
        429: refusal("Too many opens from this address"),
      },
    }),
    async (c) => {
      const answer = await feedProof(c.env, c.var.address, c.req.valid("param").proofId);
      if (answer.kind === "limit") return limitRefused(c, answer.refusal, null);
      if (answer.kind === "notFound") return refuse(c, 404, "feed.photoNotFound");
      return c.body(new Uint8Array(answer.bytes), 200, {
        "content-type": "image/jpeg",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex",
      });
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/reports/{ticketNumber}/proofs/{proofId}/public",
      request: {
        params: ticketParams.extend({ proofId: z.uuid() }),
        body: jsonBody(z.object({ public: z.boolean() })),
      },
      responses: {
        200: jsonResponse("Marked, with the report as it is now", deskReportSchema),
        404: refusal("No such photo of this report in this account's region"),
      },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      const { ticketNumber, proofId } = c.req.valid("param");
      return changeAnswered(
        c,
        await markProofPublic(c.env, staffOf(c), ticketNumber, proofId, c.req.valid("json").public),
      );
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/reports/{ticketNumber}/event/release",
      request: { params: ticketParams },
      responses: {
        200: jsonResponse("Out of its event, with the report as it is now", deskReportSchema),
        404: refusal("No such report in this account's region, or it is of no event"),
      },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      return changeAnswered(c, await releaseReport(c.env, staffOf(c), c.req.valid("param").ticketNumber));
    },
  );
}
