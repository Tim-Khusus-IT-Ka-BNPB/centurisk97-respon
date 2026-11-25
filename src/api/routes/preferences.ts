import { createRoute, z } from "@hono/zod-openapi";
import { deleteCookie, setCookie } from "hono/cookie";
import { type Api, addRoute, jsonBody } from "../route";

const THEME_COOKIE = "theme";
const YEAR_SECONDS = 365 * 24 * 60 * 60;

export function addPreferenceRoutes(api: Api): void {
  // The colour theme for this browser. It names no person, so it needs no consent; "device"
  // forgets the choice and follows the device's own setting again.
  addRoute(
    api,
    "public",
    createRoute({
      method: "post",
      path: "/preferences/theme",
      request: { body: jsonBody(z.object({ theme: z.enum(["device", "light", "dark"]) })) },
      responses: { 204: { description: "Kept in a cookie, or forgotten for device" } },
    }),
    (c) => {
      const { theme } = c.req.valid("json");
      const secure = new URL(c.req.url).protocol === "https:";
      if (theme === "device") deleteCookie(c, THEME_COOKIE, { path: "/", secure });
      else
        setCookie(c, THEME_COOKIE, theme, { path: "/", secure, httpOnly: true, sameSite: "Lax", maxAge: YEAR_SECONDS });
      return c.body(null, 204);
    },
  );
}
