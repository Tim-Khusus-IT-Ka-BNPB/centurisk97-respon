import { type ReactNode, useEffect } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  type ShouldRevalidateFunctionArgs,
  useFetchers,
  useRouteLoaderData,
} from "react-router";
import { languageFrom } from "../src/copy/languages";
import { makeText } from "../src/copy/text";
import type { Route } from "./+types/root";
import styles from "./app.css?url";
import { NavProgress } from "./components/atoms/NavProgress";
import { FailedScreen } from "./components/organisms/FailedScreen";
import { FAILED_TEXTS } from "./lib/failedTexts";
import { drawnTheme, type Theme, themeFromCookie } from "./lib/theme";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/manifest.webmanifest" },
];

// The site's address, so every page's canonical and share links are absolute, the theme this
// browser picked, so the page is drawn in it from the first paint, and the language its public pages
// are in (the desk is Indonesian).
export const loader = ({ request, context }: Route.LoaderArgs) => ({
  origin: context.origin,
  theme: themeFromCookie(request.headers.get("cookie")),
  language: new URL(request.url).pathname.startsWith("/desk") ? "id" : languageFrom(request.headers.get("cookie")),
});

// Only a theme or a language picked changes them. Left out of every other refresh, they stay when it
// fails, and so does the theme.
export const shouldRevalidate = ({ formAction }: ShouldRevalidateFunctionArgs) =>
  formAction === "/theme" || formAction === "/language";

// Every page has its own; this is what is left when the page cannot be shown.
export const meta: Route.MetaFunction = () => [
  { title: makeText(FAILED_TEXTS)("failed.page", { appName: "app.name" }) },
  { name: "robots", content: "noindex, nofollow" },
];

const BAR = { light: "#e9eff7", dark: "#142235" } as const;

// The theme in use: a switch still on its way wins, so the page changes at the tap.
function useTheme(): Theme {
  const loaded = useRouteLoaderData<typeof loader>("root");
  const pending = useFetchers()
    .find((fetcher) => fetcher.formAction === "/theme")
    ?.formData?.get("theme");
  return (pending as Theme | undefined) ?? loaded?.theme ?? drawnTheme();
}

export function Layout({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const language = useRouteLoaderData<typeof loader>("root")?.language ?? "id";
  return (
    <html lang={language} data-theme={theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content" />
        <meta name="color-scheme" content={theme} />
        {/* The browser bar takes the header band's colour. */}
        <meta name="theme-color" content={BAR[theme]} />
        <Meta />
        {/* Its precedence keeps the sheet where a page that cannot be shown draws the head again: asked
            for anew with no signal, it would not come, and that page would be bare. */}
        <link rel="stylesheet" href={styles} precedence="app" />
        <Links />
      </head>
      <body className="font-sans text-body">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// The service worker that opens pages seen before with no signal (LR-03); built pages only, as the dev
// server's modules change on every save.
function useOfflinePages() {
  useEffect(() => {
    if (import.meta.env.PROD && "serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
}

export default function App() {
  useOfflinePages();
  return (
    <>
      <NavProgress />
      <Outlet />
    </>
  );
}

export const ErrorBoundary = FailedScreen;
