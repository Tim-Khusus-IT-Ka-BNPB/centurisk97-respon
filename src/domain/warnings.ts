// Who may be warned of what (M07, upstream pw_inti.js): a phone picks up to three districts, the
// hazards it wants, and from which level. Region codes only, never a point.

// The outlook's hazards a phone can be warned of, each a bit of the subscription's choice.
export const WARNING_HAZARDS = [
  ["BNJ", 1],
  ["LSR", 2],
  ["ASP", 4],
  ["CEX", 8],
] as const;
export const ALL_HAZARDS = 15;
export const MAX_DISTRICTS = 3;
// Phones in all: past it a new phone is refused, one already in may still change.
export const MAX_SUBSCRIBERS = 5000;

// Only the browsers' own push services, so the sender is never pointed at any other address.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
];

export function pushEndpointOk(endpoint: string): boolean {
  if (endpoint.length > 1000 || !URL.canParse(endpoint)) return false;
  const url = new URL(endpoint);
  return url.protocol === "https:" && PUSH_HOSTS.some((host) => host.test(url.hostname));
}

// The phone's own keys for the message, as the browser gives them (base64url).
export const pushKeysOk = (p256dh: string, auth: string) =>
  /^[A-Za-z0-9_-]{80,100}$/.test(p256dh) && /^[A-Za-z0-9_-]{20,30}$/.test(auth);
