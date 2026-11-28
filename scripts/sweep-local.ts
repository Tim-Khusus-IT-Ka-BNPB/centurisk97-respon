import { createServer } from "vite";

// The run every 15 minutes, once and now, on the database in .env: the sweep, then the warnings.
// Loaded through Vite, as pnpm dev loads the server, for the imports only Vite reads (?inline).
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { createApp, readSettings } = await load<typeof import("../src/platform/app")>("/src/platform/app.ts");
const { connect } = await load<typeof import("../src/platform/postgres")>("/src/platform/postgres.ts");
const { photoStoreOf } = await load<typeof import("../src/platform/services")>("/src/platform/services.ts");

const started = readSettings(process.env);
if (started === null) process.exit(1);
const database = await connect(started.settings.databaseUrl);
try {
  const app = createApp({
    ...started,
    db: database.db,
    photos: photoStoreOf(started.settings),
    pages: async () => new Response(null, { status: 404 }),
    runtime: "script",
  });
  await app.scheduled();
  console.log("sweep:local: done");
} catch {
  console.error("sweep:local failed; the log line above says which step");
  process.exitCode = 1;
} finally {
  await database.close();
  await vite.close();
}
