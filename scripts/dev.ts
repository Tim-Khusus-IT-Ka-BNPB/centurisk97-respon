import { createRequestHandler, type ServerBuild } from "react-router";
import { createServer } from "vite";

// pnpm dev: Vite builds the pages as they change and loads the server through itself, so the
// server takes the same imports the pages do (?inline, JSON).
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { serve } = (await vite.ssrLoadModule(
  "/src/platform/node/serve.ts",
)) as typeof import("../src/platform/node/serve");
await serve({
  pages: createRequestHandler(
    () => vite.ssrLoadModule("virtual:react-router/server-build") as Promise<ServerBuild>,
    "development",
  ),
  middleware: vite.middlewares,
  onStop: () => vite.close(),
});
