// Fires the Worker's scheduled handler on a running local server, as the cron trigger would.
const origin = process.env.SWEEP_ORIGIN ?? "http://localhost:5173";
const url = `${origin}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent("*/15 * * * *")}`;

const response = await fetch(url).catch(() => null);
if (!response?.ok) {
  console.error(`sweep:local failed: no server answered at ${origin}. Start it with pnpm dev first.`);
  process.exit(1);
}
console.log(`sweep:local: scheduled run done (${response.status})`);
