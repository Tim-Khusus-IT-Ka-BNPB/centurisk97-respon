import { createRoute, z } from "@hono/zod-openapi";
import { setCookie } from "hono/cookie";
import { LANGUAGE_COOKIE, OFFERED } from "../../copy/languages";
import { type Api, addRoute, jsonBody } from "../route";

const THEME_COOKIE = "theme";
const YEAR_SECONDS = 365 * 24 * 60 * 60;

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
      setCookie(c, THEME_COOKIE, theme, { path: "/", secure, httpOnly: true, sameSite: "Lax", maxAge: YEAR_SECONDS });
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
