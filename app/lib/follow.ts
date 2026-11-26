// Events followed on the Alun-alun (D86): kept on this device alone, with no account, as each
// entry's status when it was followed, so a change since can be marked.
const KEY = "lapor-followed";

export type Followed = Readonly<Record<string, string>>;

export function followed(): Followed {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return typeof stored === "object" && stored !== null && !Array.isArray(stored) ? (stored as Followed) : {};
  } catch {
    return {};
  }
}

// Followed now, or not any more; what is followed after.
export function toggleFollow(id: string, status: string): Followed {
  const { [id]: was, ...rest } = followed();
  const next = was === undefined ? { ...rest, [id]: status } : rest;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage refused (a private window): followed for this visit only.
  }
  return next;
}
