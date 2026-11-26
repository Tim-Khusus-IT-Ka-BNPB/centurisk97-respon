// The service worker of /lapor (LR-03): a page seen before opens again with no signal, from the copy
// kept here. Pages: the network first, the kept copy when it fails. Built files, whose names carry
// their content's hash: the kept copy first. The API is never kept. Raise VERSION when this file changes.
const VERSION = "lapor-3";
const KEPT = `${VERSION}-pages`;
// Kept at install: the home and the emergency page, so a report can be made with no signal.
const FIRST = ["/lapor", "/lapor/darurat"];
// Only these pages are ever kept: never the desk, or a reporter's own report with its details.
const KEEPABLE = new Set([
  ...FIRST,
  "/lapor/help",
  "/lapor/about",
  "/lapor/privacy",
  "/lapor/feed",
  "/lapor/info",
  "/lapor/lacak",
]);

// Kept at install with them: the emblem every page draws, so a page with no signal is drawn whole.
// Built files are kept as they are asked for, never all at install: fetching them all there held up
// a phone's first map.
const SHELL = ["/lambang-bnpb.png", "/icons/192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(KEPT);
      const named = new Set(SHELL);
      await Promise.all(
        FIRST.map(async (path) => {
          const response = await fetch(path, { credentials: "same-origin" }).catch(() => null);
          if (!response?.ok) return;
          await cache.put(path, response);
        }),
      );
      await Promise.all(
        [...named].map(async (path) => {
          const response = await fetch(path).catch(() => null);
          if (response?.ok) await cache.put(path, response);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("lapor-") && key !== KEPT) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

const built = (path) => path.startsWith("/assets/") || /\.(?:png|woff2?|css)$/.test(path);

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate" && KEEPABLE.has(url.pathname)) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(KEPT).then((cache) => cache.put(url.pathname, copy)));
          }
          return response;
        } catch {
          const kept = (await caches.match(url.pathname)) ?? (await caches.match("/lapor"));
          return kept ?? Response.error();
        }
      })(),
    );
    return;
  }
  if (!built(url.pathname)) return;
  event.respondWith(
    (async () => {
      const kept = await caches.match(request);
      if (kept) return kept;
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(KEPT).then((cache) => cache.put(request, copy)));
      }
      return response;
    })(),
  );
});

// A warning of the outlook (M07): shown as sent, and a tap opens its Info daerah page. Only a page of
// this site is ever opened.
self.addEventListener("push", (event) => {
  const message = (() => {
    try {
      return event.data?.json() ?? null;
    } catch {
      return null;
    }
  })();
  if (!message || typeof message.title !== "string") return;
  const url = typeof message.url === "string" && message.url.startsWith("/lapor/") ? message.url : "/lapor/info";
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: typeof message.body === "string" ? message.body : "",
      icon: "/icons/192.png",
      badge: "/icons/192.png",
      tag: url,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/lapor/info";
  event.waitUntil(
    (async () => {
      for (const client of await self.clients.matchAll({ type: "window" }))
        if (new URL(client.url).pathname === url.split("?")[0] && "focus" in client) {
          await client.navigate(url);
          return client.focus();
        }
      return self.clients.openWindow(url);
    })(),
  );
});
