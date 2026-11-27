import { afterEach, expect, test, vi } from "vitest";
import { manualClock, TEST_ORIGIN, testEdgeStore } from "../../testing/api";
import { edgeCache } from "./edgeCache";

afterEach(() => vi.unstubAllGlobals());

test("keeps a text for its seconds under the site's own host, then reads none", async () => {
  const clock = manualClock("2026-11-27T00:00:00.000Z");
  const store = testEdgeStore(clock);
  const put = vi.spyOn(store, "put");
  const cache = edgeCache(TEST_ORIGIN, store);
  expect(await cache.get("feed?a")).toBeNull();
  await cache.put("feed?a", "kept", 60);
  expect(put.mock.calls[0]?.[0]).toBe(`${TEST_ORIGIN}/api/_edge/feed?a`);
  clock.advance(59_000);
  expect(await cache.get("feed?a")).toBe("kept");
  expect(await cache.get("feed?b")).toBeNull();
  clock.advance(2000);
  expect(await cache.get("feed?a")).toBeNull();
});

test("uses the Worker's cache when there is one, and keeps nothing when there is none", async () => {
  const none = edgeCache(TEST_ORIGIN);
  await none.put("feed?a", "kept", 60);
  expect(await none.get("feed?a")).toBeNull();
  vi.stubGlobal("caches", { default: testEdgeStore({ now: Date.now }) });
  const worker = edgeCache(TEST_ORIGIN);
  await worker.put("feed?a", "kept", 60);
  expect(await worker.get("feed?a")).toBe("kept");
});
