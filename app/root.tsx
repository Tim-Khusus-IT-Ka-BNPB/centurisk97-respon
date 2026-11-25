import type { ReactNode } from "react";
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
import { makeText } from "../src/copy/text";
import type { Route } from "./+types/root";
import { NavProgress } from "./components/atoms/NavProgress";
import { FailedScreen } from "./components/organisms/FailedScreen";
import { FAILED_TEXTS } from "./lib/failedTexts";
import { drawnTheme, type Theme, themeFromCookie } from "./lib/theme";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
];

// The site's address, so every page's canonical and share links are absolute, and the theme this
// browser picked, so the page is drawn in it from the first paint.
export const loader = ({ request, context }: Route.LoaderArgs) => ({
  origin: context.origin,
  theme: themeFromCookie(request.headers.get("cookie")),
});

// Only a theme picked changes them. Left out of every other refresh, they stay when it fails, and so
// does the theme.
export const shouldRevalidate = ({ formAction }: ShouldRevalidateFunctionArgs) => formAction === "/lapor/theme";

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
    .find((fetcher) => fetcher.formAction === "/lapor/theme")
    ?.formData?.get("theme");
  return (pending as Theme | undefined) ?? loaded?.theme ?? drawnTheme();
}

export function Layout({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <html lang="id" data-theme={theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content" />
        <meta name="color-scheme" content={theme} />
        {/* The browser bar takes the header band's colour. */}
        <meta name="theme-color" content={BAR[theme]} />
        <Meta />
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

export default function App() {
  return (
    <>
      <NavProgress />
      <Outlet />
    </>
  );
}

export const ErrorBoundary = FailedScreen;
