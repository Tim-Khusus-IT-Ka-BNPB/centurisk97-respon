// The colour theme a person picked for this browser: light, the default, or dark. Kept in a cookie
// so the server draws the page in that theme from the first paint.
export type Theme = "light" | "dark";

export const themeFromCookie = (header: string | null): Theme =>
  /(?:^|;\s*)theme=dark(?:;|$)/.test(header ?? "") ? "dark" : "light";

// One button flips between the two.
export const nextTheme = (current: Theme): Theme => (current === "light" ? "dark" : "light");

// Where to return after a switch: a page of this site under /lapor, never another host.
export function safeReturn(path: unknown): string {
  return typeof path === "string" && /^\/lapor(?:[/?#]|$)/.test(path) ? path : "/lapor";
}
