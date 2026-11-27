import { createRoute, z } from "@hono/zod-openapi";
import { commentsSchema, newCommentSchema, postedCommentSchema, reportedCommentSchema } from "../../contract/comments";
import { deskReportSchema } from "../../contract/desk";
import { cardComments, decideFigure, moderateComment, postComment, reportCardComment } from "../../services/comments";
import type { Reporter } from "../../services/emergency";
import type { ApiContext } from "../context";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { changeAnswered, staffOf, ticketParams } from "./desk";
import { fieldErrors, limitRefused } from "./shared";

const reporterOf = (c: ApiContext) => c.var.principal as Reporter;
const cardParams = z.object({ cardId: z.string().regex(/^[0-9a-f]{16}$/) });
const commentParams = z.object({ commentId: z.string().regex(/^[0-9a-f]{16}$/) });
const reason = z.string().max(1000).optional();

// Comments on the Alun-alun's cards (upstream lapor_komen, row 30), and the desk's decisions on them.
export function addCommentRoutes(api: Api): void {
  addRoute(
    api,
    "public",
    createRoute({
      method: "get",
      path: "/feed/cards/{cardId}/comments",
      request: { params: cardParams },
      responses: {
        200: jsonResponse("A card's comments everyone may read, oldest first", commentsSchema),
        429: refusal("Too many opens from this address"),
      },
    }),
    async (c) => {
      const answer = await cardComments(c.env, c.var.address, c.req.valid("param").cardId);
      if (answer.kind === "limit") return limitRefused(c, answer.refusal, null);
      return c.json(answer.comments, 200);
    },
  );

  addRoute(
    api,
    "reporter",
    createRoute({
      method: "post",
      path: "/feed/cards/{cardId}/comments",
      request: { params: cardParams, body: jsonBody(newCommentSchema) },
      responses: {
        201: jsonResponse("Kept, as it is shown: contacts and fine addresses taken out", postedCommentSchema),
        403: refusal("No reporter is known on this phone or in this session"),
        404: refusal("The card is not on the Alun-alun now"),
        422: refusal("Empty, too long, rude, or a run of one character, on field text"),
        429: refusal("Too many comments from this address or number"),
      },
    }),
    async (c) => {
      const answer = await postComment(
        c.env,
        reporterOf(c),
        c.var.address,
        c.req.valid("param").cardId,
        c.req.valid("json").text,
      );
      if (answer.kind === "ok") return c.json({ comment: answer.comment }, 201);
      if (answer.kind === "unknownReporter") return refuse(c, 403, "comments.unknownReporter");
      if (answer.kind === "notShown") return refuse(c, 404, "comments.notShown");
      if (answer.kind === "invalid")
        return refuse(c, 422, "request.invalidFields", {
          fields: fieldErrors([{ fieldId: "text", rule: answer.rule, params: {} }]),
        });
      return limitRefused(c, answer.refusal, null);
    },
  );

  addRoute(
    api,
    "reporter",
    createRoute({
      method: "post",
      path: "/feed/comments/{commentId}/report",
      request: { params: commentParams },
      responses: {
        200: jsonResponse("Counted, or this person had reported it already", reportedCommentSchema),
        400: refusal("The comment is this reporter's own"),
        403: refusal("No reporter is known on this phone or in this session"),
        404: refusal("No such comment shown"),
        429: refusal("Too many reports from this address or number"),
      },
    }),
    async (c) => {
      const answer = await reportCardComment(c.env, reporterOf(c), c.var.address, c.req.valid("param").commentId);
      if (answer.kind === "ok") return c.json({ counted: answer.counted }, 200);
      if (answer.kind === "unknownReporter") return refuse(c, 403, "comments.unknownReporter");
      if (answer.kind === "notFound") return refuse(c, 404, "comments.notFound");
      if (answer.kind === "own") return refuse(c, 400, "comments.own");
      return limitRefused(c, answer.refusal, null);
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/reports/{ticketNumber}/comments/{commentId}",
      request: {
        params: ticketParams.merge(commentParams),
        body: jsonBody(z.object({ shown: z.boolean(), reason })),
      },
      responses: {
        200: jsonResponse("Hidden or shown again, with the report as it is now", deskReportSchema),
        404: refusal("No such comment on this report's card in this account's region"),
        409: refusal("The comment is that way already"),
      },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      const { ticketNumber, commentId } = c.req.valid("param");
      return changeAnswered(c, await moderateComment(c.env, staffOf(c), ticketNumber, commentId, c.req.valid("json")));
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/reports/{ticketNumber}/comment-figures/{figureId}",
      request: {
        params: ticketParams.extend({ figureId: z.coerce.number().int().positive() }),
        body: jsonBody(
          z.object({
            accept: z.boolean(),
            field: z.enum(["housesHeavy", "housesModerate", "housesLight"]).optional(),
            reason,
          }),
        ),
      },
      responses: {
        200: jsonResponse("Taken into the report the card shows, or turned down", deskReportSchema),
        403: refusal("The report the card shows is outside this account's region"),
        404: refusal("No such figure on this report's card in this account's region"),
        409: refusal("Decided already, the report changed, or it is closed"),
        422: refusal("Houses without their damage, or a figure the report's kind does not use, on field field"),
      },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      const { ticketNumber, figureId } = c.req.valid("param");
      return changeAnswered(c, await decideFigure(c.env, staffOf(c), ticketNumber, figureId, c.req.valid("json")));
    },
  );
}
