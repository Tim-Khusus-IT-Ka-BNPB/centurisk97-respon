// The colour theme a person picked for this browser: light, dark, or the device's own setting.
// Kept in a cookie so the server draws the page in that theme from the first paint.
const THEMES = ["device", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export function themeFromCookie(header: string | null): Theme {
  const found = /(?:^|;\s*)theme=(light|dark)(?:;|$)/.exec(header ?? "")?.[1];
  return (found as Theme | undefined) ?? "device";
}

// One button walks the three in turn.
export const nextTheme = (current: Theme): Theme => THEMES[(THEMES.indexOf(current) + 1) % THEMES.length] as Theme;

// Where to return after a switch: a page of this site under /lapor, never another host.
export function safeReturn(path: unknown): string {
  return typeof path === "string" && /^\/lapor(?:[/?#]|$)/.test(path) ? path : "/lapor";
}
