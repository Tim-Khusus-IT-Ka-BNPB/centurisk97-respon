import { createRoute, z } from "@hono/zod-openapi";
import { draftBodySchema, sentResponseSchema } from "../../contract/draft";
import { GROUP_IDS } from "../../domain/fields/catalogue";
import { checkLimits } from "../../services/limits";
import { sendDraft } from "../../services/send";
import { readDraft, type TurnRequest, takeTurn } from "../../services/turn";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { answered, limitRefused, requestHash } from "./shared";

const draftParams = z.object({ draftId: z.string().max(64) });

const turnBody = z.object({
  revision: z.number().int().nonnegative(),
  turnKey: z.uuid(),
  kind: z.enum(["answer", "freeText", "locate", "back", "editGroup", "cancel", "confirm", "dismiss"]),
  cardId: z.string().max(40).nullable().default(null),
  optionIds: z.array(z.string().max(60)).max(40).default([]),
  values: z.record(z.string().max(60), z.string().max(4000)).default({}),
  // Longer than a message may be, so the refusal can say how long it was.
  text: z.string().max(12_000).default(""),
  // A group of the summary, or the photos of news for a sent report.
  groupId: z
    .enum([...GROUP_IDS, "photos"])
    .nullable()
    .default(null),
  villageCode: z.string().max(20).nullable().default(null),
});

const sendBody = z.object({ revision: z.number().int().nonnegative(), turnKey: z.uuid() });

const draft = (description: string) => jsonResponse(description, draftBodySchema);

export function addDraftRoutes(api: Api): void {
  addRoute(
    api,
    "reporter",
    createRoute({
      method: "get",
      path: "/drafts/{draftId}",
      request: { params: draftParams },
      responses: { 200: draft("The draft"), 410: refusal("Expired, to its owner"), 429: refusal("A limit is reached") },
    }),
    async (c) => {
      const limited = await checkLimits(c.env, [["address.draftReads", { kind: "address", bucket: c.var.address }]]);
      if (limited) return limitRefused(c, limited, null);
      return answered(c, await readDraft(c.env, c.var.principal, c.req.valid("param").draftId));
    },
  );

  addRoute(
    api,
    "reporter",
    createRoute({
      method: "post",
      path: "/drafts/{draftId}/turns",
      request: { params: draftParams, body: jsonBody(turnBody) },
      responses: {
        200: draft("The next card"),
        409: refusal("The draft changed; the envelope holds the current draft"),
        410: refusal("Expired, to its owner"),
        422: refusal("A field is refused, or the turn key was used for another answer"),
        429: refusal("A limit is reached"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const request: TurnRequest = { ...body, groupId: body.groupId };
      const answer = await takeTurn(
        c.env,
        c.var.principal,
        c.var.address,
        c.req.valid("param").draftId,
        request,
        await requestHash(body),
      );
      return answered(c, answer);
    },
  );

  addRoute(
    api,
    "reporter",
    createRoute({
      method: "post",
      path: "/drafts/{draftId}/send",
      request: { params: draftParams, body: jsonBody(sendBody) },
      responses: {
        201: jsonResponse("Sent", sentResponseSchema),
        200: jsonResponse("Already sent, the same ticket", sentResponseSchema),
        409: refusal("The draft changed, or news for this report is no longer taken"),
        410: refusal("Expired, to its owner"),
        422: refusal("The turn key was used for another answer, or a follow-up holds nothing new"),
        429: refusal("Send limit"),
        503: refusal("Not sent; nothing was stored"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const answer = await sendDraft(
        c.env,
        c.var.principal,
        c.req.valid("param").draftId,
        body.revision,
        body.turnKey,
        await requestHash(body),
      );
      if (answer.kind === "followUpClosed")
        return refuse(c, 409, "followUp.closed", {
          params: { reason: `followUp.closed.${answer.reason}` },
          draft: answer.draft,
        });
      if (answer.kind === "failed") return refuse(c, 503, "send.failed", { draft: answer.draft });
      return answered(c, answer);
    },
  );
}
