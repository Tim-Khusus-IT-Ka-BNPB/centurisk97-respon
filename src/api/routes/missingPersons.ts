import { createRoute, z } from "@hono/zod-openapi";
import { MISSING_STATUSES } from "../../domain/missingPerson";
import type { Reporter } from "../../services/emergency";
import {
  deskMissing,
  deskMissingOne,
  deskMissingPhoto,
  moveDeskMissing,
  myMissing,
  reportMissing,
} from "../../services/missingPersons";
import type { ApiContext } from "../context";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { answered, staffOf } from "./desk";
import { fieldErrors, jpegFile, jpegSent } from "./shared";

const box = (max: number) => z.string().max(max).default("");

const missingForm = z.object({
  villageCode: z.string().regex(/^\d{2}\.\d{2}\.\d{2}\.\d{4}$/),
  name: box(200),
  nickname: box(100),
  relation: box(40),
  sex: box(40),
  age: box(10),
  clothes: box(300),
  marks: box(300),
  lastSeenDate: box(20),
  lastSeenTime: box(10),
  personNumber: box(60),
  contactNumber: box(60),
  waitPlace: box(400),
  // An empty file box arrives as an empty text on some runtimes.
  photo: z
    .union([z.instanceof(File), z.literal("")])
    .openapi({ type: "string", format: "binary" })
    .optional(),
});

const statusSchema = z.enum(MISSING_STATUSES);
const idParams = z.object({ id: z.uuid() });
const anyObject = z.object({}).passthrough();

export function addMissingPersonRoutes(api: Api): void {
  addRoute(
    api,
    "reporter",
    createRoute({
      method: "post",
      path: "/missing",
      request: { body: { content: { "multipart/form-data": { schema: missingForm } }, required: true } },
      responses: {
        201: jsonResponse("The report is with the desk of its region", z.object({ id: z.uuid() })),
        401: refusal("Nobody has reported from here yet"),
        404: refusal("The last seen place is not a village of the place data"),
        422: refusal("A field is refused, on its field, or the photo cannot be read"),
        429: refusal("This number has sent its five of the day"),
      },
    }),
    async (c) => {
      const { photo, ...input } = c.req.valid("form");
      const bytes = photo instanceof File && photo.size > 0 ? new Uint8Array(await photo.arrayBuffer()) : null;
      const answer = await reportMissing(c.env, c.var.principal as Reporter, input, bytes);
      if (answer.kind === "sent") return c.json({ id: answer.id }, 201);
      if (answer.kind === "unknownReporter") return refuse(c, 401, "auth.signInFirst");
      if (answer.kind === "unknownPlace") return refuse(c, 404, "missing.placeUnknown");
      if (answer.kind === "tooMany") return refuse(c, 429, "missing.tooMany");
      if (answer.kind === "badPhoto")
        return refuse(c, 422, "request.invalidFields", {
          fields: fieldErrors([{ fieldId: "photo", rule: "missing.photo", params: {} }]),
        });
      return refuse(c, 422, "request.invalidFields", {
        fields: fieldErrors(answer.errors.map((one) => ({ fieldId: one.field, rule: one.rule, params: {} }))),
      });
    },
  );

  addRoute(
    api,
    "reporter",
    createRoute({
      method: "get",
      path: "/missing/mine",
      responses: { 200: jsonResponse("This phone's missing-person reports, newest first", z.array(anyObject)) },
    }),
    async (c: ApiContext) => c.json(await myMissing(c.env, c.var.principal as Reporter), 200),
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "get",
      path: "/desk/missing",
      request: { query: z.object({ status: statusSchema.optional() }) },
      responses: { 200: jsonResponse("Missing persons of this account's region, newest first", anyObject) },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      return answered(c, await deskMissing(c.env, staffOf(c), c.req.valid("query").status ?? null));
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "get",
      path: "/desk/missing/{id}",
      request: { params: idParams },
      responses: { 200: jsonResponse("One missing person, with what was done", anyObject) },
    }),
    async (c) => {
      c.header("x-robots-tag", "noindex");
      return answered(c, await deskMissingOne(c.env, staffOf(c), c.req.valid("param").id));
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "post",
      path: "/desk/missing/{id}/status",
      request: {
        params: idParams,
        body: jsonBody(z.object({ to: statusSchema, note: z.string().max(600).default("") })),
      },
      responses: {
        200: jsonResponse("Moved", z.object({ status: statusSchema })),
        409: refusal("Not a move from its status, or another officer moved it first"),
      },
    }),
    async (c) => {
      const { to, note } = c.req.valid("json");
      const moved = await moveDeskMissing(c.env, staffOf(c), c.req.valid("param").id, to, note);
      if (moved.kind === "refusedMove") return refuse(c, 409, "missing.moveRefused");
      return answered(c, moved);
    },
  );

  addRoute(
    api,
    "staff",
    createRoute({
      method: "get",
      path: "/desk/missing/{id}/photo",
      request: { params: idParams },
      responses: { 200: jpegFile("The missing person's photo, metadata stripped") },
    }),
    async (c) => {
      const file = await deskMissingPhoto(c.env, staffOf(c), c.req.valid("param").id);
      return file.kind === "file" ? jpegSent(c, file.bytes) : answered(c, file);
    },
  );
}
