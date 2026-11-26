import { createRoute, z } from "@hono/zod-openapi";
import { setCookie } from "hono/cookie";
import { type DraftRecord, loadDraft } from "../../adapters/d1/drafts";
import { DEVICE_COOKIE } from "../../adapters/identity/seeded";
import { draftBodySchema, meResponseSchema } from "../../contract/draft";
import { checkIdentity } from "../../domain/identityForm";
import { PRIVACY } from "../../domain/privacy";
import { LIFE_LINE } from "../../services/draftView";
import { checkLimits } from "../../services/limits";
import { giveConsent, knownReporters, posterVillage, removeProfile, startDraft } from "../../services/reporters";
import { viewOf } from "../../services/turn";
import type { ApiContext } from "../context";
import { refuse } from "../envelope";
import { type Api, addRoute, jsonBody, jsonResponse, refusal } from "../route";
import { fieldErrors, limitRefused } from "./shared";

const DEVICE_KEY_DAYS = 365;
const text = (max: number) => z.string().max(max);

const villageCode = z.string().regex(/^\d{2}\.\d{2}\.\d{2}\.\d{4}$/);

const consentBody = z.object({
  role: text(40),
  name: text(400),
  number: text(60).optional(),
  officerRegency: text(400).default(""),
  officerPosition: text(400).default(""),
  privacyVersion: z.literal(PRIVACY.version),
  agree: z.literal(true),
  emergency: z.boolean().default(false),
  // A poster's village (D131): the new draft starts with it as its place.
  villageCode: villageCode.optional(),
});

const identityEdit = z.object({
  role: text(40),
  name: text(400),
  officerRegency: text(400).default(""),
  officerPosition: text(400).default(""),
});

const startBody = z.object({
  profileId: z.uuid(),
  replaceOpenDraft: z.boolean().default(false),
  profileEdit: identityEdit.optional(),
  emergency: z.boolean().default(false),
  villageCode: villageCode.optional(),
});

async function createdDraft(c: ApiContext, draftId: string): Promise<Response> {
  const draft = (await loadDraft(c.env.db, draftId)) as DraftRecord;
  return c.json(await viewOf(c.env, draft, [LIFE_LINE], null), 201);
}

export function addReporterRoutes(api: Api): void {
  addRoute(
    api,
    "public",
    createRoute({
      method: "get",
      path: "/me",
      responses: { 200: jsonResponse("Numbers known on this device or session", meResponseSchema) },
    }),
    async (c) => c.json(await knownReporters(c.env, c.var.principal), 200),
  );

  addRoute(
    api,
    "public",
    createRoute({
      method: "post",
      path: "/consent",
      request: { body: jsonBody(consentBody) },
      responses: {
        201: jsonResponse("The first draft", draftBodySchema),
        404: refusal("Staff cannot report here"),
        422: refusal("A field is refused"),
        429: refusal("A limit is reached"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const principal = c.var.principal;
      if (principal.kind === "staff") return refuse(c, 404, "draft.notFound");
      const number = principal.kind === "session" ? null : (body.number ?? "");
      const checked = checkIdentity({ ...body, number });
      if ("errors" in checked) return refuse(c, 422, "request.invalidFields", { fields: fieldErrors(checked.errors) });
      const limited = await checkLimits(c.env, [["address.bindings", { kind: "address", bucket: c.var.address }]]);
      if (limited) return limitRefused(c, limited, null);
      const village = await posterVillage(c.env, body.villageCode ?? null);
      const result = await giveConsent(c.env, principal, checked.identity, body.emergency, null, village);
      if (result.kind === "deviceFull") return limitRefused(c, { limitId: "device.numbers", retryAtMs: null }, null);
      if (result.deviceKey !== null) {
        setCookie(c, DEVICE_COOKIE, result.deviceKey, {
          httpOnly: true,
          // Every request in production is https. WebKit drops a Secure cookie sent over plain
          // http, even from localhost, so the local and test servers send it without.
          secure: new URL(c.req.url).protocol === "https:",
          sameSite: "Lax",
          path: "/",
          maxAge: DEVICE_KEY_DAYS * 24 * 60 * 60,
        });
      }
      return createdDraft(c, result.draftId);
    },
  );

  addRoute(
    api,
    "reporter",
    createRoute({
      method: "post",
      path: "/drafts",
      request: { body: jsonBody(startBody) },
      responses: {
        201: jsonResponse("A new draft", draftBodySchema),
        409: refusal("A draft is open; the envelope holds it"),
        422: refusal("A changed field is refused"),
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      let edit = null;
      if (body.profileEdit) {
        const checked = checkIdentity({ ...body.profileEdit, number: null });
        if ("errors" in checked)
          return refuse(c, 422, "request.invalidFields", { fields: fieldErrors(checked.errors) });
        edit = checked.identity;
      }
      const result = await startDraft(
        c.env,
        c.var.principal,
        body.profileId,
        body.replaceOpenDraft,
        edit,
        body.emergency,
        await posterVillage(c.env, body.villageCode ?? null),
      );
      if (result.kind === "notFound") return refuse(c, 404, "draft.notFound");
      if (result.kind === "openExists") {
        const open = (await loadDraft(c.env.db, result.draftId)) as DraftRecord;
        const hazardType = open.hazardType === null ? "resume.noHazardType" : `hazard.${open.hazardType}.label`;
        return refuse(c, 409, "draft.openExists", {
          params: { hazardType },
          draft: await viewOf(c.env, open, [], null),
        });
      }
      return createdDraft(c, result.draftId);
    },
  );

  addRoute(
    api,
    "reporter",
    createRoute({
      method: "delete",
      path: "/me/profiles/{profileId}",
      request: { params: z.object({ profileId: z.uuid() }), body: jsonBody(z.object({ confirm: z.literal(true) })) },
      responses: { 204: { description: "Removed from this device" } },
    }),
    async (c) => {
      const removed = await removeProfile(c.env, c.var.principal, c.req.valid("param").profileId);
      return removed ? c.body(null, 204) : refuse(c, 404, "draft.notFound");
    },
  );
}
