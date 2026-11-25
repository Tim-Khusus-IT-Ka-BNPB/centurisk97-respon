import { createRoute, z } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { row, sql } from "../platform/database";
import type { ApiEnv } from "./context";
import { refuse } from "./envelope";
import { addRoute, createApi, refusal } from "./route";
import { addDeskRoutes } from "./routes/desk";
import { addDeskHandlingRoutes } from "./routes/deskHandling";
import { addDraftRoutes } from "./routes/drafts";
import { addEmergencyRoutes } from "./routes/emergency";
import { addGatewayRoutes } from "./routes/gateway";
import { addOwnReportRoutes } from "./routes/ownReports";
import { addPhotoRoutes } from "./routes/photos";
import { addPlaceRoutes } from "./routes/places";
import { addPreferenceRoutes } from "./routes/preferences";
import { addReporterRoutes } from "./routes/reporters";
import { addTrackingRoutes } from "./routes/tracking";

export const api = createApi();

// The identity adapter names the caller once, before any route's policy runs.
api.app.use(
  "*",
  createMiddleware<ApiEnv>(async (c, next) => {
    c.set("principal", await c.env.identity.resolve(c.req.raw.headers));
    await next();
  }),
);

addRoute(
  api,
  "public",
  createRoute({
    method: "get",
    path: "/health",
    responses: {
      200: { description: "The service answers", content: { "text/plain": { schema: z.string() } } },
      503: refusal("The database cannot be read"),
    },
  }),
  async (c) => {
    try {
      await row(c.env.db, sql`select 1`);
    } catch {
      return refuse(c, 503, "request.unavailable");
    }
    return c.text("ok", 200);
  },
);

addReporterRoutes(api);
addDraftRoutes(api);
addPlaceRoutes(api);
addPhotoRoutes(api);
addTrackingRoutes(api);
addOwnReportRoutes(api);
addDeskRoutes(api);
addDeskHandlingRoutes(api);
addEmergencyRoutes(api);
addPreferenceRoutes(api);
addGatewayRoutes(api);
