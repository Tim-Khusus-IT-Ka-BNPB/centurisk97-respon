import { createRoute, z } from "@hono/zod-openapi";
import { setCookie } from "hono/cookie";
import { caseListSchema, caseViewSchema, recordChangeSchema, recordInputSchema } from "../../contract/cases";
import {
  acceptCaseFile,
  addCaseMember,
  addRecordPhoto,
  CASE_COOKIE,
  type CaseActor,
  cancelCaseRecord,
  caseList,
  caseView,
  closeCaseFile,
  exchangeCaseLink,
  openCaseFile,
  recordMedia,
  removeCaseMember,
  renewCaseLink,
  reopenCaseFile,
  revealRecord,
  saveRecord,
  setCaseFields,
  setCaseNil,
  updateRecord,
} from "../../services/cases";
import type { ApiContext } from "../context";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { answered, staffOf, ticketParams } from "./desk";
import { deviceFix, fieldErrors, type limitRefused, photoForm } from "./shared";
import { rangeOf } from "./videos";

const fileParams = z.object({ fileId: z.string().regex(/^[0-9a-f]{16}$/) });
const recordParams = fileParams.extend({ recordId: z.string().regex(/^[0-9a-f]{16}$/) });
const memberParams = fileParams.extend({ memberId: z.string().regex(/^[0-9a-f]{16}$/) });
const ok = <T extends z.ZodType>(description: string, schema: T) => ({ 200: jsonResponse(description, schema) });
const fileAnswer = z.object({ fileId: z.string() });
const recordAnswer = z.object({ recordId: z.string() });
const linkAnswer = z.object({ memberId: z.string(), link: z.string() });

const actorOf = (c: ApiContext): CaseActor =>
  c.var.principal?.kind === "staff"
    ? { kind: "staff", staff: staffOf(c) }
    : { kind: "member", member: c.var.caseMember };

type Answer =
  | { readonly kind: "ok"; readonly body: unknown }
  | { readonly kind: "notFound" }
  | { readonly kind: "notAllowed" }
  | { readonly kind: "limit"; readonly refusal: Parameters<typeof limitRefused>[1] }
  | { readonly kind: "closed" }
  | { readonly kind: "changed" }
  | { readonly kind: "invalid"; readonly errors: readonly string[] }
  | { readonly kind: "photoRefused"; readonly rule: string }
  | { readonly kind: "refused"; readonly rule: string };

// Every answer of the file's routes, the same way: a value refused on its own field.
export function caseAnswered(c: ApiContext, answer: Answer): Response {
  c.header("x-robots-tag", "noindex");
  c.header("cache-control", "private, no-store");
  if (answer.kind === "closed") return refuse(c, 409, "cases.closed");
  if (answer.kind === "changed") return refuse(c, 409, "cases.changed");
  if (answer.kind === "notFound") return refuse(c, 404, "cases.notFound");
  if (answer.kind === "invalid")
    return refuse(c, 422, "request.invalidFields", {
      fields: fieldErrors(answer.errors.map((fieldId) => ({ fieldId, rule: "case.value", params: {} }))),
    });
  if (answer.kind === "photoRefused")
    return refuse(c, 422, "request.invalidFields", {
      fields: fieldErrors([{ fieldId: "photo", rule: `photo.${answer.rule}`, params: {} }]),
    });
  if (answer.kind === "refused")
    return refuse(c, 422, "request.invalidFields", {
      fields: fieldErrors([{ fieldId: "video", rule: answer.rule, params: {} }]),
    });
  return answered(c, answer);
}

// The BPBD's follow-up files (M09): opened and kept from the desk, filled by its team on the web.
export function addCaseRoutes(api: Api): void {
  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/reports/{ticketNumber}/case",
      request: { params: ticketParams },
      responses: {
        ...ok("The report's file, opened now or before", fileAnswer),
        404: refusal("Not a report of this regency's BPBD"),
      },
    }),
    async (c) => caseAnswered(c, await openCaseFile(c.env, staffOf(c), c.req.valid("param").ticketNumber)),
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "get",
      path: "/desk/cases",
      responses: ok("The files this account may read, newest first", caseListSchema),
    }),
    async (c) => caseAnswered(c, await caseList(c.env, staffOf(c))),
  );

  addRoute(
    api,
    "caseTeam",
    createRoute({
      method: "get",
      path: "/cases/{fileId}",
      request: { params: fileParams },
      responses: {
        ...ok("The file as this reader may see it; the opening is logged", caseViewSchema),
        404: refusal("No such file for this reader"),
      },
    }),
    async (c) => caseAnswered(c, await caseView(c.env, actorOf(c), c.req.valid("param").fileId)),
  );

  addRoute(
    api,
    "caseTeam",
    createRoute({
      method: "post",
      path: "/cases/{fileId}/records",
      request: { params: fileParams, body: jsonBody(recordInputSchema) },
      responses: {
        ...ok("Kept, or the record its client id made before", recordAnswer),
        404: refusal("No such file for this writer"),
        409: refusal("The file is closed"),
        422: refusal("A value does not fit, on its own field"),
      },
    }),
    async (c) => caseAnswered(c, await saveRecord(c.env, actorOf(c), c.req.valid("param").fileId, c.req.valid("json"))),
  );

  addRoute(
    api,
    "caseTeam",
    createRoute({
      method: "post",
      path: "/cases/{fileId}/records/{recordId}",
      request: { params: recordParams, body: jsonBody(recordChangeSchema) },
      responses: {
        ...ok("Changed", recordAnswer),
        404: refusal("No such record"),
        409: refusal("The file is closed, or the record changed since it was read"),
        422: refusal("A value does not fit, on its own field"),
      },
    }),
    async (c) => {
      const { fileId, recordId } = c.req.valid("param");
      return caseAnswered(c, await updateRecord(c.env, actorOf(c), fileId, recordId, c.req.valid("json")));
    },
  );

  addRoute(
    api,
    "caseTeam",
    createRoute({
      method: "post",
      path: "/cases/{fileId}/records/{recordId}/cancel",
      request: { params: recordParams, body: jsonBody(z.object({ reason: z.string().max(1000) })) },
      responses: {
        ...ok("Set aside with its reason", recordAnswer),
        404: refusal("No such record kept"),
        409: refusal("The file is closed"),
        422: refusal("No reason, on field reason"),
      },
    }),
    async (c) => {
      const { fileId, recordId } = c.req.valid("param");
      return caseAnswered(c, await cancelCaseRecord(c.env, actorOf(c), fileId, recordId, c.req.valid("json").reason));
    },
  );

  addRoute(
    api,
    "caseTeam",
    createRoute({
      method: "post",
      path: "/cases/{fileId}/records/{recordId}/media",
      request: {
        params: recordParams,
        body: {
          content: { "multipart/form-data": { schema: photoForm.extend({ face: z.enum(["1"]).optional() }) } },
          required: true,
        },
      },
      responses: {
        ...ok("Kept, metadata stripped", recordAnswer),
        404: refusal("No such record kept"),
        409: refusal("The file is closed"),
        422: refusal("The photo is refused, on field photo"),
      },
    }),
    async (c) => {
      const form = c.req.valid("form");
      const { fileId, recordId } = c.req.valid("param");
      const bytes = new Uint8Array(await form.photo.arrayBuffer());
      return caseAnswered(
        c,
        await addRecordPhoto(c.env, actorOf(c), fileId, recordId, {
          bytes,
          face: form.face === "1",
          device: deviceFix(form),
        }),
      );
    },
  );

  addRoute(
    api,
    "caseTeam",
    createRoute({
      method: "get",
      path: "/cases/{fileId}/media/{mediaId}",
      request: { params: fileParams.extend({ mediaId: z.uuid() }) },
      responses: {
        200: {
          description: "The photo or video; the reading is logged",
          content: { "image/jpeg": { schema: z.string() } },
        },
        206: { description: "Part of a video", content: { "video/mp4": { schema: z.string() } } },
        404: refusal("No such photo for this reader"),
      },
    }),
    async (c) => {
      const { fileId, mediaId } = c.req.valid("param");
      const answer = await recordMedia(c.env, actorOf(c), fileId, mediaId);
      if (answer.kind !== "ok") return caseAnswered(c, answer);
      const { bytes, contentType } = answer.body;
      // A video is played by range, as a phone's player and Safari ask for.
      const range = rangeOf(c.req.header("range"), bytes.length);
      const headers = {
        "content-type": contentType,
        "accept-ranges": "bytes",
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
        "x-robots-tag": "noindex",
      };
      if (range === null) return c.body(new Uint8Array(bytes), 200, headers);
      return c.body(new Uint8Array(bytes.slice(range.start, range.end + 1)), 206, {
        ...headers,
        "content-range": `bytes ${range.start}-${range.end}/${bytes.length}`,
      });
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/cases/{fileId}/records/{recordId}/reveal",
      request: { params: recordParams },
      responses: {
        ...ok("Its personal values in full; logged", z.object({ personal: z.record(z.string(), z.unknown()) })),
        404: refusal("No such record"),
      },
    }),
    async (c) => {
      const { fileId, recordId } = c.req.valid("param");
      return caseAnswered(c, await revealRecord(c.env, staffOf(c), fileId, recordId));
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/cases/{fileId}/fields",
      request: { params: fileParams, body: jsonBody(z.object({ fields: z.unknown(), revision: z.number().int() })) },
      responses: {
        ...ok("Merged", fileAnswer),
        409: refusal("Closed, or changed since it was read"),
        422: refusal("A value does not fit, on its own field"),
      },
    }),
    async (c) =>
      caseAnswered(c, await setCaseFields(c.env, staffOf(c), c.req.valid("param").fileId, c.req.valid("json"))),
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/cases/{fileId}/nil",
      request: {
        params: fileParams,
        body: jsonBody(z.object({ metric: z.string().max(40), nil: z.boolean(), revision: z.number().int() })),
      },
      responses: {
        ...ok("Marked none, or not", fileAnswer),
        409: refusal("Closed, or changed since it was read"),
        422: refusal("Not a metric, or one with records, on field metric"),
      },
    }),
    async (c) => caseAnswered(c, await setCaseNil(c.env, staffOf(c), c.req.valid("param").fileId, c.req.valid("json"))),
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/cases/{fileId}/members",
      request: {
        params: fileParams,
        body: jsonBody(z.object({ name: z.string().max(200), number: z.string().max(40) })),
      },
      responses: {
        ...ok("Added; its link is shown this once", linkAnswer),
        422: refusal("No name or no number, on its field"),
      },
    }),
    async (c) =>
      caseAnswered(c, await addCaseMember(c.env, staffOf(c), c.req.valid("param").fileId, c.req.valid("json"))),
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/cases/{fileId}/members/{memberId}/remove",
      request: { params: memberParams },
      responses: {
        ...ok("Taken off the team", z.object({ memberId: z.string() })),
        404: refusal("No such member on the team"),
      },
    }),
    async (c) => {
      const { fileId, memberId } = c.req.valid("param");
      return caseAnswered(c, await removeCaseMember(c.env, staffOf(c), fileId, memberId));
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/cases/{fileId}/members/{memberId}/link",
      request: { params: memberParams },
      responses: { ...ok("A new link, shown this once", linkAnswer), 404: refusal("No such member on the team") },
    }),
    async (c) => {
      const { fileId, memberId } = c.req.valid("param");
      return caseAnswered(c, await renewCaseLink(c.env, staffOf(c), fileId, memberId));
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/cases/{fileId}/close",
      request: {
        params: fileParams,
        body: jsonBody(
          z.object({ endedOn: z.string().max(20), note: z.string().max(2000), revision: z.number().int() }),
        ),
      },
      responses: {
        ...ok("Sealed as a version, waiting for BNPB", fileAnswer),
        409: refusal("Closed already, or changed since it was read"),
        422: refusal("A day outside the file's, or a note too long, on its field"),
      },
    }),
    async (c) =>
      caseAnswered(c, await closeCaseFile(c.env, staffOf(c), c.req.valid("param").fileId, c.req.valid("json"))),
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/cases/{fileId}/accept",
      request: { params: fileParams },
      responses: {
        ...ok("Accepted: the file ends as sealed and its ticket closes", fileAnswer),
        409: refusal("Not waiting to be accepted"),
      },
    }),
    async (c) => caseAnswered(c, await acceptCaseFile(c.env, staffOf(c), c.req.valid("param").fileId)),
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/cases/{fileId}/reopen",
      request: { params: fileParams, body: jsonBody(z.object({ reason: z.string().max(1000) })) },
      responses: {
        ...ok("Open again; the versions sealed before stay", fileAnswer),
        409: refusal("Open already"),
        422: refusal("No reason, on field reason"),
      },
    }),
    async (c) =>
      caseAnswered(c, await reopenCaseFile(c.env, staffOf(c), c.req.valid("param").fileId, c.req.valid("json").reason)),
  );

  addRoute(
    api,
    "public",
    createRoute({
      method: "post",
      path: "/case-links/{token}",
      request: { params: z.object({ token: z.string().regex(/^[0-9a-f]{32}$/) }) },
      responses: {
        ...ok("Exchanged for the member's own cookie", fileAnswer),
        404: refusal("Used, ended, or never made"),
      },
    }),
    async (c) => {
      c.header("cache-control", "private, no-store");
      const exchanged = await exchangeCaseLink(c.env, c.req.valid("param").token);
      if (exchanged === null) return refuse(c, 404, "cases.linkUsed");
      setCookie(c, CASE_COOKIE, exchanged.cookie, {
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        maxAge: exchanged.maxAge,
      });
      return c.json({ fileId: exchanged.fileId }, 200);
    },
  );
}
