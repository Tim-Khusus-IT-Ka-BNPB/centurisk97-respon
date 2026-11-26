// The browser's push, behind one seam: the panel is tested without a real push service.

// The phone as the API knows it: the push service's address and the phone's own keys.
export type PushPhone = {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
};

type Subscribed = { readonly phone: PushPhone; readonly stop: () => Promise<unknown> };

const phoneOf = (subscription: PushSubscription): Subscribed => {
  const json = subscription.toJSON();
  return {
    phone: { endpoint: subscription.endpoint, keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } },
    stop: () => subscription.unsubscribe(),
  };
};

// The page's own service worker, kept only in a built app; none means no push here.
const registration = async () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
    ? ((await navigator.serviceWorker.getRegistration("/lapor")) ?? null)
    : null;

export const pushBrowser = {
  async supported() {
    return (await registration()) !== null;
  },
  denied: () => Notification.permission === "denied",
  async current(): Promise<Subscribed | null> {
    const found = await (await registration())?.pushManager.getSubscription();
    return found ? phoneOf(found) : null;
  },
  // Asks for the phone's leave first; null when it is not given.
  async subscribe(publicKey: string): Promise<Subscribed | null> {
    if ((await Notification.requestPermission()) !== "granted") return null;
    const padded = publicKey.replace(/-/g, "+").replace(/_/g, "/");
    const key = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const found = await (await registration())?.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
    return found ? phoneOf(found) : null;
  },
};

export type PushBrowser = typeof pushBrowser;
