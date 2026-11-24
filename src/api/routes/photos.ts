import { createRoute, z } from "@hono/zod-openapi";
import { draftBodySchema } from "../../contract/draft";
import { addPhoto, readPhoto } from "../../services/photos";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonResponse, refusal } from "../route";
import { answered, requestHash } from "./shared";

const params = z.object({ draftId: z.string().max(64) });
const finite = (max: number) => z.coerce.number().refine((value) => Number.isFinite(value) && Math.abs(value) <= max);
// A box the page left empty arrives as "": no reading was sent.
const optional = <T extends z.ZodType>(schema: T) => z.union([z.literal(""), schema]).optional();

// A multipart form, so the page's own form posts it with no script. The device reading and the
// page's zone come only from a page with script.
const uploadBody = z.object({
  photo: z.instanceof(File).openapi({ type: "string", format: "binary" }),
  revision: z.coerce.number().int().nonnegative(),
  turnKey: z.uuid(),
  lat: optional(finite(90)),
  lon: optional(finite(180)),
  accuracy: optional(finite(1e7)),
  readAt: optional(z.coerce.number().int().nonnegative()),
  offset: optional(z.coerce.number().int().min(-840).max(840)),
});

const isSet = <T>(value: T | "" | undefined): value is T => value !== undefined && value !== "";

export function addPhotoRoutes(api: Api): void {
  addRoute(
    api,
    "reporter",
    createRoute({
      method: "post",
      path: "/drafts/{draftId}/photos",
      request: {
        params,
        body: { content: { "multipart/form-data": { schema: uploadBody } }, required: true },
      },
      responses: {
        200: jsonResponse("The photo is kept; the draft with it", draftBodySchema),
        409: refusal("The draft changed; the envelope holds the current draft"),
        410: refusal("Expired, to its owner"),
        422: refusal("The photo is refused, on field photo, or the turn key was used for another photo"),
        429: refusal("A limit is reached"),
      },
    }),
    async (c) => {
      const form = c.req.valid("form");
      const bytes = new Uint8Array(await form.photo.arrayBuffer());
      const device =
        isSet(form.lat) && isSet(form.lon) && isSet(form.accuracy) && isSet(form.readAt)
          ? { lat: form.lat, lon: form.lon, accuracyM: form.accuracy, readAtMs: form.readAt }
          : null;
      const { photo: _file, ...rest } = form;
      // The file's own fingerprint stands in for it, so a retry of the same photo replays.
      const fingerprint = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].join(",");
      const answer = await addPhoto(
        c.env,
        c.var.principal,
        c.var.address,
        c.req.valid("param").draftId,
        {
          revision: form.revision,
          turnKey: form.turnKey,
          bytes,
          device,
          offsetMinutes: isSet(form.offset) ? form.offset : null,
        },
        await requestHash({ ...rest, fingerprint }),
      );
      return answered(c, answer);
    },
  );

  // Public, so a file that is not the caller's answers 404 whoever asks, signed out included (AC-09);
  // the service checks the owner.
  addRoute(
    api,
    "public",
    createRoute({
      method: "get",
      path: "/drafts/{draftId}/photos/{photoId}",
      request: { params: params.extend({ photoId: z.uuid() }) },
      responses: {
        200: { description: "The photo, metadata stripped", content: { "image/jpeg": { schema: z.string() } } },
        404: refusal("No such photo for this reporter"),
      },
    }),
    async (c) => {
      const { draftId, photoId } = c.req.valid("param");
      const file = await readPhoto(c.env, c.var.principal, draftId, photoId);
      if (file.kind === "notFound") return refuse(c, 404, "draft.notFound");
      return c.body(new Uint8Array(file.bytes), 200, {
        "content-type": "image/jpeg",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex",
      });
    },
  );
}
