import { createRoute, z } from "@hono/zod-openapi";
import {
  completeVideo,
  deskVideo,
  listVideos,
  putVideoPart,
  startVideo,
  takeBackVideo,
  type VideoAnswer,
  videoProgress,
} from "../../services/videos";
import type { ApiContext } from "../context";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { answered, staffOf, ticketParams } from "./desk";
import { fieldErrors, limitRefused } from "./shared";

const draft = z.object({ draftId: z.uuid() });
const one = draft.extend({ videoId: z.uuid() });
const progressSchema = z.object({
  id: z.uuid(),
  parts: z.number().int().positive(),
  partBytes: z.number().int().positive(),
  received: z.array(z.number().int().nonnegative()),
});
const listSchema = z.array(z.object({ id: z.uuid(), seconds: z.number().int(), container: z.string() }));

function videoAnswered<T>(c: ApiContext, answer: VideoAnswer<T>): Response {
  if (answer.kind === "ok") return c.json(answer.body as object, 200);
  if (answer.kind === "expired") return refuse(c, 410, "draft.expired");
  if (answer.kind === "notFound") return refuse(c, 404, "draft.notFound");
  if (answer.kind === "limit") return limitRefused(c, answer.refusal, null);
  return refuse(c, 422, "request.invalidFields", {
    fields: fieldErrors([{ fieldId: "video", rule: answer.rule, params: {} }]),
  });
}

const refusals = {
  404: refusal("No such draft or upload for this reporter"),
  410: refusal("Expired, to its owner"),
  422: refusal("The video is refused, on field video"),
};

// The byte range a player asks for, or null for the whole file.
export function rangeOf(header: string | undefined, size: number): { start: number; end: number } | null {
  const found = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!found || (found[1] === "" && found[2] === "")) return null;
  const start = found[1] === "" ? Math.max(0, size - Number(found[2])) : Number(found[1]);
  const end = found[1] === "" || found[2] === "" ? size - 1 : Math.min(Number(found[2]), size - 1);
  return start <= end ? { start, end } : null;
}

export function addVideoRoutes(api: Api): void {
  addRoute(
    api,
    "reporter",
    createRoute({
      method: "post",
      path: "/drafts/{draftId}/videos",
      request: {
        params: draft,
        body: jsonBody(z.object({ bytes: z.number().int(), seconds: z.number().nonnegative().nullable() })),
      },
      responses: { 200: jsonResponse("The upload, and the parts it wants", progressSchema), ...refusals },
    }),
    async (c) =>
      videoAnswered(
        c,
        await startVideo(c.env, c.var.principal, c.var.address, c.req.valid("param").draftId, c.req.valid("json")),
      ),
  );

  addRoute(
    api,
    "reporter",
    createRoute({
      method: "get",
      path: "/drafts/{draftId}/videos",
      request: { params: draft },
      responses: { 200: jsonResponse("The videos kept with the draft", listSchema), ...refusals },
    }),
    async (c) => videoAnswered(c, await listVideos(c.env, c.var.principal, c.req.valid("param").draftId)),
  );

  addRoute(
    api,
    "reporter",
    createRoute({
      method: "get",
      path: "/drafts/{draftId}/videos/{videoId}",
      request: { params: one },
      responses: { 200: jsonResponse("The parts that have landed", progressSchema), ...refusals },
    }),
    async (c) => {
      const { draftId, videoId } = c.req.valid("param");
      return videoAnswered(c, await videoProgress(c.env, c.var.principal, draftId, videoId));
    },
  );

  // A part's bytes as the body, so a phone sends no form around 5 MB.
  addRoute(
    api,
    "reporter",
    createRoute({
      method: "put",
      path: "/drafts/{draftId}/videos/{videoId}/parts/{n}",
      request: { params: one.extend({ n: z.coerce.number().int().min(0).max(5) }) },
      responses: { 200: jsonResponse("Kept; the parts that have landed", progressSchema), ...refusals },
    }),
    async (c) => {
      const { draftId, videoId, n } = c.req.valid("param");
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      return videoAnswered(c, await putVideoPart(c.env, c.var.principal, draftId, videoId, n, bytes));
    },
  );

  addRoute(
    api,
    "reporter",
    createRoute({
      method: "post",
      path: "/drafts/{draftId}/videos/{videoId}/complete",
      request: { params: one },
      responses: { 200: jsonResponse("Whole, checked and kept; the draft's videos", listSchema), ...refusals },
    }),
    async (c) => {
      const { draftId, videoId } = c.req.valid("param");
      return videoAnswered(c, await completeVideo(c.env, c.var.principal, draftId, videoId));
    },
  );

  addRoute(
    api,
    "reporter",
    createRoute({
      method: "delete",
      path: "/drafts/{draftId}/videos/{videoId}",
      request: { params: one },
      responses: { 200: jsonResponse("Taken back; the draft's videos", listSchema), ...refusals },
    }),
    async (c) => {
      const { draftId, videoId } = c.req.valid("param");
      return videoAnswered(c, await takeBackVideo(c.env, c.var.principal, draftId, videoId));
    },
  );

  // Played on the desk: a range answers 206, as a phone's player and Safari ask for.
  addRoute(
    api,
    "staff",
    createRoute({
      method: "get",
      path: "/desk/reports/{ticketNumber}/videos/{videoId}",
      request: { params: ticketParams.extend({ videoId: z.uuid() }) },
      responses: {
        200: { description: "The video", content: { "video/mp4": { schema: z.string() } } },
        206: { description: "Part of the video", content: { "video/mp4": { schema: z.string() } } },
      },
    }),
    async (c) => {
      const { ticketNumber, videoId } = c.req.valid("param");
      const file = await deskVideo(c.env, staffOf(c), ticketNumber, videoId);
      if (file.kind !== "file") return answered(c, file);
      const size = file.bytes.length;
      const range = rangeOf(c.req.header("range"), size);
      const headers = {
        "content-type": file.contentType,
        "accept-ranges": "bytes",
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      };
      if (range === null) return c.body(new Uint8Array(file.bytes), 200, headers);
      return c.body(new Uint8Array(file.bytes.slice(range.start, range.end + 1)), 206, {
        ...headers,
        "content-range": `bytes ${range.start}-${range.end}/${size}`,
      });
    },
  );
}
