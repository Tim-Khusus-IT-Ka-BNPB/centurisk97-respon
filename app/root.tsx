import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
];

// The site's address, so every page's canonical and share links are absolute.
export const loader = ({ context }: Route.LoaderArgs) => ({ origin: context.origin });

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content" />
        <meta name="color-scheme" content="light dark" />
        {/* The browser bar takes the header band's colour. */}
        <meta name="theme-color" content="#e9eff7" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#142235" media="(prefers-color-scheme: dark)" />
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
  return <Outlet />;
}
