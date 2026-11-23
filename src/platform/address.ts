// The client address as a limit bucket: an IPv4 address whole, an IPv6 address by its /64
// prefix. Only cf-connecting-ip is read; x-forwarded-for is set by the client and never trusted.
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/;
const HEXTET = /^[0-9a-f]{1,4}$/;
const IPV6_GROUPS = 8;
const PREFIX_GROUPS = 4;

function ipv4(text: string): string | null {
  const match = IPV4.exec(text);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets.join(".") : null;
}

function groupsOf(part: string | undefined): string[] {
  return part === undefined || part === "" ? [] : part.split(":");
}

function ipv6Prefix(text: string): string | null {
  const mapped = MAPPED_IPV4.exec(text);
  if (mapped) return ipv4(mapped[1] as string);
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = groupsOf(halves[0]);
  const tail = groupsOf(halves[1]);
  const compressed = halves.length === 2;
  const missing = IPV6_GROUPS - head.length - tail.length;
  if (compressed ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (!groups.every((group) => HEXTET.test(group))) return null;
  const prefix = groups.slice(0, PREFIX_GROUPS).map((group) => Number.parseInt(group, 16).toString(16));
  return `${prefix.join(":")}::/64`;
}

export function addressBucket(text: string): string | null {
  const lower = text.toLowerCase();
  return lower.includes(":") ? ipv6Prefix(lower) : ipv4(lower);
}

const LOOPBACK_BUCKET = "loopback";

// Null means the request carries no usable address and is refused.
export function clientAddress(headers: Headers, fallback: "loopback" | null): string | null {
  const value = headers.get("cf-connecting-ip")?.trim() ?? "";
  if (value === "") return fallback === null ? null : LOOPBACK_BUCKET;
  return addressBucket(value);
}
