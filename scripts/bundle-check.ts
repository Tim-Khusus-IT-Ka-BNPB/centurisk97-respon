import { type ChildProcess, spawn } from "node:child_process";
import { gzipSync } from "node:zlib";

// Fails when the gzipped HTML, CSS and script the report page transfers before the map exceed
// the budget. It builds and starts the app itself, measures, and always stops what it started.
const BUDGET_BYTES = 300 * 1024;
const PORT = 8787;
const ORIGIN = `http://localhost:${PORT}`;
const PAGES = ["/lapor"];
const MAP_ASSET = /maplibre/i;

async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await fetch(`${ORIGIN}/api/lapor/health`)
      .then((response) => response.ok)
      .catch(() => false);
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the app did not answer on ${ORIGIN} in time`);
}

function assetPaths(html: string): string[] {
  const found = html.match(/\/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g) ?? [];
  return [...new Set(found)].filter((path) => !MAP_ASSET.test(path));
}

async function gzippedSize(path: string): Promise<number> {
  const response = await fetch(`${ORIGIN}${path}`);
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return gzipSync(Buffer.from(await response.arrayBuffer()), { level: 9 }).length;
}

async function measure(page: string): Promise<number> {
  const response = await fetch(`${ORIGIN}${page}`);
  if (!response.ok) throw new Error(`${page} answered ${response.status}`);
  const html = await response.text();
  let total = gzipSync(Buffer.from(html), { level: 9 }).length;
  for (const path of assetPaths(html)) total += await gzippedSize(path);
  return total;
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    // The preview runs a chain of processes; signalling the group stops every one of them.
    if (child.pid) process.kill(-child.pid, "SIGTERM");
  });
}

const server = spawn("pnpm", ["-s", "preview"], { stdio: "ignore", detached: true });
let failed = false;
try {
  await waitForHealth(120_000);
  for (const page of PAGES) {
    const bytes = await measure(page);
    const kb = (bytes / 1024).toFixed(1);
    const over = bytes > BUDGET_BYTES;
    failed ||= over;
    console.log(`${page}: ${kb} KB gzipped before the map, budget ${BUDGET_BYTES / 1024} KB${over ? ", OVER" : ""}`);
  }
} catch (error: unknown) {
  failed = true;
  console.error(`bundle check failed: ${error instanceof Error ? error.message : "unknown error"}`);
} finally {
  await stop(server);
}
process.exit(failed ? 1 : 0);
