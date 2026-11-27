// The colour theme a person picked for this browser: light, the default, or dark. Kept in a cookie
// so the server draws the page in that theme from the first paint.
export type Theme = "light" | "dark";

export const themeFromCookie = (header: string | null): Theme =>
  /(?:^|;\s*)theme=dark(?:;|$)/.test(header ?? "") ? "dark" : "light";

// The theme the page is drawn in, for when what the server said of it was lost with a refresh.
export const drawnTheme = (): Theme =>
  globalThis.document?.documentElement.dataset.theme === "dark" ? "dark" : "light";

// One button flips between the two.
export const nextTheme = (current: Theme): Theme => (current === "light" ? "dark" : "light");

// Where to return after a switch: a page of this site, never another host. "//host" and "/\\host"
// are read by browsers as another host, so a second slash or backslash is refused.
export function safeReturn(path: unknown): string {
  return typeof path === "string" && /^\/(?![/\\])/.test(path) ? path : "/";
}
