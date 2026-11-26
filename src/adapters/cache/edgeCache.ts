import type { EdgeCache } from "../../ports/edgeCache";

// What the adapter needs of Cloudflare's cache: a response kept under an address.
export type EdgeStore = {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
};

// A Worker's own cache; the page types know caches only as the browser's.
const workerStore = () =>
  typeof caches === "undefined" ? null : (caches as unknown as { default: EdgeStore }).default;

// Cloudflare's cache, under an address on the site's own host. With no cache, as under Node,
// nothing is kept and every read is fresh.
export function edgeCache(origin: string, store: EdgeStore | null = workerStore()): EdgeCache {
  const address = (key: string) => `${origin}/api/lapor/_edge/${key}`;
  return {
    async get(key) {
      const kept = await store?.match(address(key));
      return kept === undefined ? null : kept.text();
    },
    async put(key, text, seconds) {
      await store?.put(
        address(key),
        new Response(text, { headers: { "cache-control": `public, max-age=${seconds}` } }),
      );
    },
  };
}
