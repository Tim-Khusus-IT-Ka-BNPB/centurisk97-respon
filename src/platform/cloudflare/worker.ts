import { createRequestHandler } from "react-router";
import type { ApiCall } from "../../api/bridge";
import { createWorker } from "./handler";

declare module "react-router" {
  interface AppLoadContext {
    runtime: string;
    // The site's address from the setting, for absolute canonical and share links.
    origin: string;
    // Hands a page loader or form action's call to the Hono route inside the Worker.
    api: ApiCall;
  }
}

const pages = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);

export default createWorker(pages, navigator.userAgent);
