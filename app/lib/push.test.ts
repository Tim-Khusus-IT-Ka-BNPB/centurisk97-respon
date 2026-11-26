import { afterEach, describe, expect, test, vi } from "vitest";
import { pushBrowser } from "./push";

const KEY = `B${"A".repeat(86)}`;
const unsubscribe = vi.fn(async () => true);
const subscription = (keys: { p256dh: string; auth: string } | undefined) => ({
  endpoint: "https://fcm.googleapis.com/fcm/send/uji",
  toJSON: () => ({ keys }),
  unsubscribe,
});

function browserWith(options: {
  registered?: boolean;
  existing?: ReturnType<typeof subscription> | null;
  leave?: string;
}) {
  const subscribe = vi.fn(async (_options: PushSubscriptionOptionsInit) =>
    subscription({ p256dh: "p".repeat(87), auth: "a".repeat(22) }),
  );
  const registration = { pushManager: { getSubscription: async () => options.existing ?? null, subscribe } };
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", {
    permission: options.leave ?? "default",
    requestPermission: async () => options.leave ?? "granted",
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: async () => (options.registered === false ? undefined : registration) },
  });
  return { subscribe };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("the browser's push", () => {
  test("no service worker, or no push in this browser: not supported, and nothing is current", async () => {
    expect(await pushBrowser.supported()).toBe(false);
    expect(await pushBrowser.current()).toBeNull();
    browserWith({ registered: false });
    expect(await pushBrowser.supported()).toBe(false);
  });

  test("a phone already subscribed gives its address and keys, and stops", async () => {
    browserWith({ existing: subscription({ p256dh: "x".repeat(87), auth: "y".repeat(22) }) });
    expect(await pushBrowser.supported()).toBe(true);
    expect(pushBrowser.denied()).toBe(false);
    const current = await pushBrowser.current();
    expect(current?.phone).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/uji",
      keys: { p256dh: "x".repeat(87), auth: "y".repeat(22) },
    });
    await current?.stop();
    expect(unsubscribe).toHaveBeenCalled();
    browserWith({ existing: subscription(undefined) });
    expect((await pushBrowser.current())?.phone.keys).toEqual({ p256dh: "", auth: "" });
  });

  test("subscribing asks leave first, then hands the server's key as bytes", async () => {
    const { subscribe } = browserWith({});
    const made = await pushBrowser.subscribe(KEY);
    expect(made?.phone.keys.auth).toBe("a".repeat(22));
    const key = subscribe.mock.calls[0]?.[0].applicationServerKey as Uint8Array;
    expect([key.length, key[0]]).toEqual([65, 4]);
    expect(subscribe.mock.calls[0]?.[0].userVisibleOnly).toBe(true);
  });

  test("leave refused: nothing is subscribed, and the refusal is known after", async () => {
    const { subscribe } = browserWith({ leave: "denied" });
    expect(await pushBrowser.subscribe(KEY)).toBeNull();
    expect(subscribe).not.toHaveBeenCalled();
    expect(pushBrowser.denied()).toBe(true);
  });

  test("leave given but the worker gone by then: nothing is subscribed", async () => {
    browserWith({ registered: false });
    expect(await pushBrowser.subscribe(KEY)).toBeNull();
  });
});
