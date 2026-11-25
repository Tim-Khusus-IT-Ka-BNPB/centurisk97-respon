import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useFetchers, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/root";
import { NavProgress } from "./components/atoms/NavProgress";
import { type Theme, themeFromCookie } from "./lib/theme";
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

const BAR = { light: "#e9eff7", dark: "#142235" } as const;

// The theme in use: a switch still on its way wins, so the page changes at the tap.
function useTheme(): Theme {
  const loaded = useRouteLoaderData<typeof loader>("root");
  const pending = useFetchers()
    .find((fetcher) => fetcher.formAction === "/lapor/theme")
    ?.formData?.get("theme");
  return (pending as Theme | undefined) ?? loaded?.theme ?? "light";
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
