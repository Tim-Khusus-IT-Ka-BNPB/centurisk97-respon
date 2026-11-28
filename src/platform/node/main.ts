import { createRequestHandler, type ServerBuild } from "react-router";
import { serve } from "./serve";

// The server as the image runs it: the pages from the build beside this file (build/node/main.js),
// and the built files in build/client. Development starts from scripts/dev.ts instead.
const build = new URL("../server/index.js", import.meta.url).href;
await serve({
  pages: createRequestHandler(() => import(build) as Promise<ServerBuild>, "production"),
  middleware: null,
});
