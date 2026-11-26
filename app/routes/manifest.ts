import { copy } from "../../src/copy";

// The app as a phone installs it (K29): its name, icons and the ways in from the home screen.
const NAVY = "#0b2545";

export const loader = () =>
  Response.json(
    {
      name: copy.text("app.name"),
      short_name: copy.text("app.shortName"),
      description: copy.text("app.install.description"),
      lang: "id",
      id: "/lapor",
      start_url: "/lapor",
      scope: "/lapor",
      display: "standalone",
      background_color: NAVY,
      theme_color: NAVY,
      icons: [
        { src: "/icons/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icons/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
      shortcuts: [
        { name: copy.text("app.install.report"), url: "/lapor/report" },
        { name: copy.text("app.install.emergency"), url: "/lapor/report?darurat=1" },
        { name: copy.text("app.install.feed"), url: "/lapor/feed" },
      ].map((shortcut) => ({ ...shortcut, icons: [{ src: "/icons/192.png", sizes: "192x192" }] })),
    },
    { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } },
  );
