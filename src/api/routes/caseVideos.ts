import { createRoute, z } from "@hono/zod-openapi";
import type { CaseActor } from "../../services/cases";
import {
  caseVideoProgress,
  caseVideos,
  completeCaseVideo,
  putCaseVideoPart,
  startCaseVideo,
  takeBackCaseVideo,
} from "../../services/caseVideos";
import type { ApiContext } from "../context";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { caseAnswered } from "./cases";
import { staffOf } from "./desk";
import { listSchema, progressSchema } from "./videos";

const record = z.object({
  fileId: z.string().regex(/^[0-9a-f]{16}$/),
  recordId: z.string().regex(/^[0-9a-f]{16}$/),
});
const one = record.extend({ videoId: z.uuid() });
const refusals = {
  404: refusal("No such record or upload for this writer"),
  409: refusal("The file is closed"),
  422: refusal("The video is refused, on field video"),
};
const actorOf = (c: ApiContext): CaseActor =>
  c.var.principal?.kind === "staff"
    ? { kind: "staff", staff: staffOf(c) }
    : { kind: "member", member: c.var.caseMember };

// A video of a house or a piece of infrastructure, sent in parts (upstream LJ-18).
export function addCaseVideoRoutes(api: Api): void {
  const base = "/cases/{fileId}/records/{recordId}/videos";
  addRoute(
    api,
    "caseTeam",
    createRoute({
      method: "get",
      path: base,
      request: { params: record },
      responses: { 200: jsonResponse("The record's videos", listSchema), ...refusals },
    }),
    async (c) => {
      const { fileId, recordId } = c.req.valid("param");
      return caseAnswered(c, await caseVideos(c.env, actorOf(c), fileId, recordId));
    },
  );

  addRoute(
    api,
    "caseTeam",
    createRoute({
      method: "post",
      path: base,
      request: {
        params: record,
        body: jsonBody(z.object({ bytes: z.number().int(), seconds: z.number().nonnegative().nullable() })),
      },
      responses: { 200: jsonResponse("The upload, and the parts it wants", progressSchema), ...refusals },
    }),
    async (c) => {
      const { fileId, recordId } = c.req.valid("param");
      return caseAnswered(c, await startCaseVideo(c.env, actorOf(c), fileId, recordId, c.req.valid("json")));
    },
  );

  addRoute(
    api,
    "caseTeam",
    createRoute({
      method: "get",
      path: `${base}/{videoId}`,
      request: { params: one },
      responses: { 200: jsonResponse("The parts that have landed", progressSchema), ...refusals },
    }),
    async (c) => {
      const { fileId, recordId, videoId } = c.req.valid("param");
      return caseAnswered(c, await caseVideoProgress(c.env, actorOf(c), fileId, recordId, videoId));
    },
  );

  addRoute(
    api,
    "caseTeam",
    createRoute({
      method: "put",
      path: `${base}/{videoId}/parts/{n}`,
      request: { params: one.extend({ n: z.coerce.number().int().min(0).max(5) }) },
      responses: { 200: jsonResponse("Kept; the parts that have landed", progressSchema), ...refusals },
    }),
    async (c) => {
      const { fileId, recordId, videoId, n } = c.req.valid("param");
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      return caseAnswered(c, await putCaseVideoPart(c.env, actorOf(c), fileId, recordId, videoId, { n, bytes }));
    },
  );

  addRoute(
    api,
    "caseTeam",
    createRoute({
      method: "post",
      path: `${base}/{videoId}/complete`,
      request: { params: one },
      responses: { 200: jsonResponse("Whole, checked and kept; the record's videos", listSchema), ...refusals },
    }),
    async (c) => {
      const { fileId, recordId, videoId } = c.req.valid("param");
      return caseAnswered(c, await completeCaseVideo(c.env, actorOf(c), fileId, recordId, videoId));
    },
  );

  addRoute(
    api,
    "caseTeam",
    createRoute({
      method: "delete",
      path: `${base}/{videoId}`,
      request: { params: one },
      responses: { 200: jsonResponse("Taken back; the record's videos", listSchema), ...refusals },
    }),
    async (c) => {
      const { fileId, recordId, videoId } = c.req.valid("param");
      return caseAnswered(c, await takeBackCaseVideo(c.env, actorOf(c), fileId, recordId, videoId));
    },
  );
}
