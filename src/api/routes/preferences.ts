import { createRoute, z } from "@hono/zod-openapi";
import { deleteCookie, setCookie } from "hono/cookie";
import { LANGUAGE_COOKIE, OFFERED } from "../../copy/languages";
import { type Api, addRoute, jsonBody } from "../route";

const THEME_COOKIE = "theme";
const YEAR_SECONDS = 365 * 24 * 60 * 60;

// One theme for every module under the same parent: respon.ksbnpb.io keeps it for ksbnpb.io, so auth
// reads the same choice. A host with no parent to share, such as localhost or an address, keeps it to itself.
export function sharedDomainOf(origin: string): string | undefined {
  const labels = new URL(origin).hostname.split(".");
  return labels.length > 2 && !/^\d+$/.test(labels.at(-1) as string) ? labels.slice(1).join(".") : undefined;
}

export function addPreferenceRoutes(api: Api): void {
  // The colour theme for this browser. It names no person, so it needs no consent.
  addRoute(
    api,
    "public",
    createRoute({
      method: "post",
      path: "/preferences/theme",
      request: { body: jsonBody(z.object({ theme: z.enum(["light", "dark"]) })) },
      responses: { 204: { description: "Kept in a cookie" } },
    }),
    (c) => {
      const { theme } = c.req.valid("json");
      const secure = new URL(c.req.url).protocol === "https:";
      const domain = sharedDomainOf(c.env.settings.appOrigin);
      // A choice kept before it was shared would be read before the shared one, so it goes.
      if (domain) deleteCookie(c, THEME_COOKIE, { path: "/", secure });
      setCookie(c, THEME_COOKIE, theme, {
        path: "/",
        domain,
        secure,
        httpOnly: true,
        sameSite: "Lax",
        maxAge: YEAR_SECONDS,
      });
      return c.body(null, 204);
    },
  );

  // The language of the report pages, from those offered. It names no person either.
  addRoute(
    api,
    "public",
    createRoute({
      method: "post",
      path: "/preferences/language",
      request: {
        body: jsonBody(z.object({ language: z.enum(OFFERED.map(([id]) => id) as [string, ...string[]]) })),
      },
      responses: { 204: { description: "Kept in a cookie" } },
    }),
    (c) => {
      const { language } = c.req.valid("json");
      const secure = new URL(c.req.url).protocol === "https:";
      setCookie(c, LANGUAGE_COOKIE, language, {
        path: "/",
        secure,
        httpOnly: true,
        sameSite: "Lax",
        maxAge: YEAR_SECONDS,
      });
      return c.body(null, 204);
    },
  );
}
